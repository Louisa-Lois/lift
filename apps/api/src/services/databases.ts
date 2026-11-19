import { randomBytes } from "node:crypto";
import { type Db, schema } from "@lift/db";
import {
  type Database,
  type DatabaseCredentials,
  type DatabaseStatusReport,
  type DatabaseType,
  DEFAULT_DATABASE_ENV_VARS,
  isLiftApiError,
  newId,
  type ProjectRole,
  type ProvisionContext,
  postgresNamesFor,
} from "@lift/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { problem } from "../lib/problem";
import { accessProject, type ProjectRow } from "./access";
import { requireSecretBox, type SecretBox } from "./crypto";
import { type DbOrTx, type EventRow, recordEvent } from "./events";

export type DatabaseRow = typeof schema.databases.$inferSelect;

const t = schema.databases;
const v = schema.variables;

export function toDatabase(row: DatabaseRow): Database {
  return {
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    name: row.name,
    status: row.status,
    host: row.host,
    port: row.port,
    envVar: row.envVar,
    createdAt: row.createdAt.toISOString(),
  };
}

/** A project's live databases, oldest first. */
export async function projectDatabases(db: DbOrTx, projectId: string): Promise<DatabaseRow[]> {
  return db
    .select()
    .from(t)
    .where(and(eq(t.projectId, projectId), isNull(t.deletedAt)))
    .orderBy(asc(t.createdAt));
}

/** A live database, after checking the caller's role in its project (404 for non-members). */
export async function accessDatabase(
  db: Db,
  databaseId: string,
  userId: string,
  needed: ProjectRole = "viewer",
): Promise<{ database: DatabaseRow; project: ProjectRow; role: ProjectRole }> {
  const [database] = await db
    .select()
    .from(t)
    .where(and(eq(t.id, databaseId), isNull(t.deletedAt)))
    .limit(1);
  if (!database) throw problem("not_found", `No database ${databaseId}.`);
  try {
    return { database, ...(await accessProject(db, database.projectId, userId, needed)) };
  } catch (error) {
    if (isLiftApiError(error) && error.code === "not_found") {
      throw problem("not_found", `No database ${databaseId}.`);
    }
    throw error;
  }
}

/**
 * `POST /projects/:id/databases` (docs/prd/01-backend-api.md, "Databases", step 1): the database
 * as `provisioning`, with a random 24-character password (stored encrypted); for Postgres the
 * database and its role are both named after the database ID. One per project and type: a second
 * would fight the first over DATABASE_URL. The caller queues `provision_db`.
 */
export async function createDatabaseRows(
  db: Db,
  input: {
    project: ProjectRow;
    type: DatabaseType;
    name: string | undefined;
    actorId: string;
    secretBox: SecretBox;
  },
): Promise<{ row: DatabaseRow; event: EventRow }> {
  const { project, type } = input;
  return db.transaction(async (tx) => {
    // Two requests at once can't both pass the check below.
    await tx
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id))
      .for("update");
    const [existing] = await tx
      .select({ name: t.name })
      .from(t)
      .where(and(eq(t.projectId, project.id), eq(t.type, type), isNull(t.deletedAt)))
      .limit(1);
    if (existing) {
      throw problem(
        "conflict",
        `This project already has a Postgres database, ${existing.name}. Each project gets one.`,
      );
    }
    const id = newId("db");
    const names = postgresNamesFor(id);
    const [row] = await tx
      .insert(t)
      .values({
        id,
        projectId: project.id,
        type,
        name: input.name ?? type,
        status: "provisioning",
        dbName: names.database,
        username: names.role,
        passwordEnc: input.secretBox.encrypt(randomBytes(18).toString("base64url")),
        envVar: DEFAULT_DATABASE_ENV_VARS[type],
      })
      .returning();
    if (!row) throw new Error("insert returned no database");
    const event = await recordEvent(tx, {
      projectId: project.id,
      actorType: "user",
      actorId: input.actorId,
      type: "database.status_changed",
      data: { ...toDatabase(row), previousStatus: null },
    });
    return { row, event };
  });
}

/**
 * `DELETE /databases/:id` (step 4): `deleting` with `deleted_at`, so it leaves every list, and the
 * variables it wrote are removed. The caller queues `deprovision_db`.
 */
export async function deleteDatabaseRows(
  db: Db,
  input: { database: DatabaseRow; actorId: string },
): Promise<{ row: DatabaseRow; events: EventRow[] }> {
  const { database } = input;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(t)
      .set({ status: "deleting", deletedAt: new Date() })
      .where(eq(t.id, database.id))
      .returning();
    if (!row) throw new Error("update returned no database");
    const removed = await tx
      .delete(v)
      .where(eq(v.databaseId, row.id))
      .returning({ serviceId: v.serviceId, key: v.key });
    const events: EventRow[] = [];
    for (const { serviceId, key } of removed) {
      events.push(
        await recordEvent(tx, {
          projectId: row.projectId,
          actorType: "user",
          actorId: input.actorId,
          type: "variables.changed",
          data: { serviceId, keys: [key] },
        }),
      );
    }
    events.push(
      await recordEvent(tx, {
        projectId: row.projectId,
        actorType: "user",
        actorId: input.actorId,
        type: "database.status_changed",
        data: { ...toDatabase(row), previousStatus: database.status },
      }),
    );
    return { row, events };
  });
}

/** `postgres://{role}:{password}@lift-pg:5432/{database}`, reachable from the project's network. */
export function connectionUrl(row: DatabaseRow, password: string): string {
  if (!row.host || !row.port || !row.username || !row.dbName) {
    throw new Error(`database ${row.id} has nowhere to connect to yet`);
  }
  return `postgres://${row.username}:${encodeURIComponent(password)}@${row.host}:${row.port}/${row.dbName}`;
}

/** `GET /databases/:id/credentials` (editors): how to connect, once the database is ready. */
export function credentialsOf(row: DatabaseRow, secretBox: SecretBox): DatabaseCredentials {
  if (row.status !== "ready" || !row.host || !row.port) {
    throw problem(
      "conflict",
      `${row.name} is ${row.status}; its credentials come once it's ready.`,
    );
  }
  const password = secretBox.decrypt(row.passwordEnc);
  return {
    url: connectionUrl(row, password),
    host: row.host,
    port: row.port,
    username: row.username,
    password,
    database: row.dbName,
  };
}

/**
 * Writes a ready database's connection string into one service as `source: database` (step 3),
 * unless the service has that key from a user or the agent, or already has it from this database.
 * True when it wrote something.
 */
export async function writeDatabaseVariable(
  tx: DbOrTx,
  input: { serviceId: string; database: DatabaseRow; secretBox: SecretBox },
): Promise<boolean> {
  const { database, serviceId } = input;
  const [existing] = await tx
    .select({ source: v.source, databaseId: v.databaseId })
    .from(v)
    .where(and(eq(v.serviceId, serviceId), eq(v.key, database.envVar)))
    .limit(1);
  if (existing && (existing.source !== "database" || existing.databaseId === database.id)) {
    return false;
  }
  const valueEnc = input.secretBox.encrypt(
    connectionUrl(database, input.secretBox.decrypt(database.passwordEnc)),
  );
  const now = new Date();
  await tx
    .insert(v)
    .values({
      id: newId("var"),
      serviceId,
      key: database.envVar,
      valueEnc,
      source: "database",
      databaseId: database.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [v.serviceId, v.key],
      set: { valueEnc, source: "database", databaseId: database.id, updatedAt: now },
    });
  return true;
}

/** A new service gets the connection string of each of its project's ready databases. */
export async function addDatabaseVariables(
  tx: DbOrTx,
  input: { projectId: string; serviceId: string; secretBox: SecretBox },
): Promise<void> {
  for (const database of await projectDatabases(tx, input.projectId)) {
    if (database.status !== "ready") continue;
    await writeDatabaseVariable(tx, {
      serviceId: input.serviceId,
      database,
      secretBox: input.secretBox,
    });
  }
}

/** `GET /internal/v1/databases/:id/provision-context`: the credentials, while provisioning. */
export async function provisionContext(
  db: Db,
  secretBox: SecretBox | null,
  databaseId: string,
): Promise<ProvisionContext> {
  const [row] = await db.select().from(t).where(eq(t.id, databaseId)).limit(1);
  if (!row) throw problem("not_found", `No database ${databaseId}.`);
  // `ready` too: a provision job run again after a worker restart does the same work.
  if (row.deletedAt || (row.status !== "provisioning" && row.status !== "ready")) {
    throw problem("conflict", `Database ${databaseId} is ${row.status}.`);
  }
  return {
    databaseId: row.id,
    projectId: row.projectId,
    type: row.type,
    dbName: row.dbName,
    username: row.username,
    password: requireSecretBox(secretBox).decrypt(row.passwordEnc),
  };
}

/**
 * The worker's report (`POST /internal/v1/databases/:id/status`), under a row lock. `ready` stores
 * where to reach the database and writes its connection string into every service of the project
 * (step 3); `failed` records that provisioning failed. A deleted database answers `failed` with no
 * change and anything else with 409, as does a report that comes too late to matter.
 */
export async function applyDatabaseReport(
  db: Db,
  input: { databaseId: string; report: DatabaseStatusReport; secretBox: SecretBox | null },
): Promise<{ row: DatabaseRow; events: EventRow[] }> {
  const { report } = input;
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(t).where(eq(t.id, input.databaseId)).for("update");
    if (!row) throw problem("not_found", `No database ${input.databaseId}.`);
    if (row.deletedAt) {
      if (report.status === "failed") return { row, events: [] };
      throw problem("conflict", `Database ${row.id} was deleted: drop it instead.`);
    }
    const changed = (updated: DatabaseRow) =>
      recordEvent(tx, {
        projectId: row.projectId,
        actorType: "worker",
        actorId: null,
        type: "database.status_changed",
        data: { ...toDatabase(updated), previousStatus: row.status },
      });

    if (report.status === "failed") {
      // A ready database stays ready: a repeated provision job failing doesn't undo it.
      if (row.status !== "provisioning") return { row, events: [] };
      const [updated] = await tx
        .update(t)
        .set({ status: "failed" })
        .where(eq(t.id, row.id))
        .returning();
      if (!updated) throw new Error("update returned no database");
      return { row: updated, events: [await changed(updated)] };
    }

    if (row.status === "failed") {
      throw problem("conflict", `Database ${row.id} already failed.`);
    }
    const secretBox = requireSecretBox(input.secretBox);
    const [updated] = await tx
      .update(t)
      .set({ status: "ready", host: report.host, port: report.port })
      .where(eq(t.id, row.id))
      .returning();
    if (!updated) throw new Error("update returned no database");
    const events: EventRow[] = row.status === "ready" ? [] : [await changed(updated)];
    const services = await tx
      .select({ id: schema.services.id })
      .from(schema.services)
      .where(and(eq(schema.services.projectId, row.projectId), isNull(schema.services.deletedAt)));
    for (const service of services) {
      const wrote = await writeDatabaseVariable(tx, {
        serviceId: service.id,
        database: updated,
        secretBox,
      });
      if (!wrote) continue;
      events.push(
        await recordEvent(tx, {
          projectId: row.projectId,
          actorType: "system",
          actorId: null,
          type: "variables.changed",
          data: { serviceId: service.id, keys: [updated.envVar] },
        }),
      );
    }
    return { row: updated, events };
  });
}
