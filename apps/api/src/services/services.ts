import { type Db, schema } from "@lift/db";
import {
  appHostname,
  appUrl,
  type CreateServiceBody,
  type DeploymentSummary,
  isLiftApiError,
  newId,
  type ProjectRole,
  SERVICE_DEFAULTS,
  type Service,
  type UpdateServiceBody,
} from "@lift/shared";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { uniqueViolation } from "../lib/db-errors";
import { problem } from "../lib/problem";
import { accessProject, type ProjectRow } from "./access";
import type { SecretBox } from "./crypto";
import { addDatabaseVariables } from "./databases";
import { type EventRow, recordEvent } from "./events";
import { slugify, subdomainFor, subdomainWithSuffix, withSuffix } from "./slugs";

export type ServiceRow = typeof schema.services.$inferSelect;

interface DeploymentFields {
  latestDeployment: DeploymentSummary | null;
  activeDeploymentId: string | null;
}

const NO_DEPLOYMENTS: DeploymentFields = { latestDeployment: null, activeDeploymentId: null };

/** A service as the API returns it; `url` is http for *.localhost, https elsewhere. */
export function toService(
  row: ServiceRow,
  appsDomain: string,
  deployments: DeploymentFields = NO_DEPLOYMENTS,
): Service {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    slug: row.slug,
    type: row.type,
    repo: { owner: row.repoOwner, name: row.repoName, branch: row.branch },
    rootDir: row.rootDir,
    builder: row.builder,
    dockerfilePath: row.dockerfilePath,
    buildCommand: row.buildCommand,
    startCommand: row.startCommand,
    port: row.port,
    healthcheckPath: row.healthcheckPath,
    cpu: row.cpu,
    memoryMb: row.memoryMb,
    subdomain: row.subdomain,
    autofix: row.autofix,
    url: appUrl(appHostname(row.subdomain, appsDomain), appsDomain),
    latestDeployment: deployments.latestDeployment,
    activeDeploymentId: deployments.activeDeploymentId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The latest and the active deployment of each service, in two queries. */
async function deploymentFields(
  db: Db,
  serviceIds: string[],
): Promise<Map<string, DeploymentFields>> {
  const fields = new Map<string, DeploymentFields>();
  if (serviceIds.length === 0) return fields;
  const d = schema.deployments;
  const latest = await db
    .selectDistinctOn([d.serviceId], {
      serviceId: d.serviceId,
      id: d.id,
      status: d.status,
      commitSha: d.commitSha,
      createdAt: d.createdAt,
    })
    .from(d)
    .where(inArray(d.serviceId, serviceIds))
    .orderBy(d.serviceId, desc(d.queuedAt));
  const active = await db
    .select({ serviceId: d.serviceId, id: d.id })
    .from(d)
    .where(and(inArray(d.serviceId, serviceIds), eq(d.status, "active")));
  for (const id of serviceIds) fields.set(id, { ...NO_DEPLOYMENTS });
  for (const row of latest) {
    const entry = fields.get(row.serviceId);
    if (entry) {
      entry.latestDeployment = {
        id: row.id,
        status: row.status,
        commitSha: row.commitSha,
        createdAt: row.createdAt.toISOString(),
      };
    }
  }
  for (const row of active) {
    const entry = fields.get(row.serviceId);
    if (entry) entry.activeDeploymentId = row.id;
  }
  return fields;
}

/** Services as the API returns them, each with its latest and active deployment. */
export async function serviceViews(
  db: Db,
  rows: ServiceRow[],
  appsDomain: string,
): Promise<Service[]> {
  const fields = await deploymentFields(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toService(row, appsDomain, fields.get(row.id)));
}

/** The live services of a project, oldest first. */
export async function projectServices(db: Db, projectId: string): Promise<ServiceRow[]> {
  return db
    .select()
    .from(schema.services)
    .where(and(eq(schema.services.projectId, projectId), isNull(schema.services.deletedAt)))
    .orderBy(asc(schema.services.createdAt));
}

/**
 * A live service, after checking the caller's role in its project. A service in a project the
 * caller can't see is reported as missing, like one that doesn't exist.
 */
export async function accessService(
  db: Db,
  serviceId: string,
  userId: string,
  needed: ProjectRole = "viewer",
): Promise<{ service: ServiceRow; project: ProjectRow; role: ProjectRole }> {
  const [service] = await db
    .select()
    .from(schema.services)
    .where(and(eq(schema.services.id, serviceId), isNull(schema.services.deletedAt)))
    .limit(1);
  if (!service) throw problem("not_found", `No service ${serviceId}.`);
  try {
    return { service, ...(await accessProject(db, service.projectId, userId, needed)) };
  } catch (error) {
    if (isLiftApiError(error) && error.code === "not_found") {
      throw problem("not_found", `No service ${serviceId}.`);
    }
    throw error;
  }
}

const MAX_ATTEMPTS = 5;

/**
 * Inserts the service, its generated domain and its `service.created` event in one transaction.
 * A slug or subdomain that clashes gets a 4-character suffix and another try.
 */
export async function createServiceRows(
  db: Db,
  input: {
    project: ProjectRow;
    actorId: string;
    body: CreateServiceBody;
    appsDomain: string;
    /** Writes the project's ready databases' connection strings into the new service. */
    secretBox?: SecretBox | null;
  },
): Promise<{ row: ServiceRow; event: EventRow }> {
  const { project, body, appsDomain } = input;
  let slug = slugify(body.name);
  let subdomain = subdomainFor(slug, project.slug);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.services)
          .values({
            id: newId("svc"),
            projectId: project.id,
            name: body.name,
            slug,
            type: SERVICE_DEFAULTS.type,
            repoOwner: body.repo.owner,
            repoName: body.repo.name,
            branch: body.branch,
            rootDir: body.rootDir ?? SERVICE_DEFAULTS.rootDir,
            builder: body.builder ?? SERVICE_DEFAULTS.builder,
            port: body.port ?? SERVICE_DEFAULTS.port,
            healthcheckPath: SERVICE_DEFAULTS.healthcheckPath,
            cpu: SERVICE_DEFAULTS.cpu,
            memoryMb: SERVICE_DEFAULTS.memoryMb,
            subdomain,
            autofix: SERVICE_DEFAULTS.autofix,
          })
          .returning();
        if (!row) throw new Error("insert returned no service");
        await tx.insert(schema.domains).values({
          id: newId("dom"),
          serviceId: row.id,
          hostname: appHostname(subdomain, appsDomain),
          kind: "generated",
          status: "active",
          verifiedAt: new Date(),
        });
        if (input.secretBox) {
          await addDatabaseVariables(tx, {
            projectId: project.id,
            serviceId: row.id,
            secretBox: input.secretBox,
          });
        }
        const event = await recordEvent(tx, {
          projectId: row.projectId,
          actorType: "user",
          actorId: input.actorId,
          type: "service.created",
          data: toService(row, appsDomain),
        });
        return { row, event };
      });
    } catch (error) {
      const constraint = uniqueViolation(error);
      if (constraint === null || attempt >= MAX_ATTEMPTS) throw error;
      if (constraint === "services_project_id_slug_index") {
        slug = withSuffix(slug);
        subdomain = subdomainFor(slug, project.slug);
      } else {
        subdomain = subdomainWithSuffix(subdomainFor(slug, project.slug));
      }
    }
  }
}

/** Applies a settings change (used from the next deploy on) and records `service.updated`. */
export async function updateServiceRows(
  db: Db,
  input: { service: ServiceRow; actorId: string; patch: UpdateServiceBody; appsDomain: string },
): Promise<{ view: Service; event: EventRow }> {
  const fields = (await deploymentFields(db, [input.service.id])).get(input.service.id);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.services)
      .set(input.patch)
      .where(eq(schema.services.id, input.service.id))
      .returning();
    if (!row) throw problem("not_found", `No service ${input.service.id}.`);
    const view = toService(row, input.appsDomain, fields);
    const event = await recordEvent(tx, {
      projectId: row.projectId,
      actorType: "user",
      actorId: input.actorId,
      type: "service.updated",
      data: view,
    });
    return { view, event };
  });
}

/**
 * Soft-deletes the service and records `service.deleted`. The caller queues `remove_service` so
 * the worker removes its containers.
 */
export async function deleteServiceRows(
  db: Db,
  input: { service: ServiceRow; actorId: string; appsDomain: string },
): Promise<EventRow> {
  const fields = (await deploymentFields(db, [input.service.id])).get(input.service.id);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.services)
      .set({ deletedAt: new Date() })
      .where(eq(schema.services.id, input.service.id))
      .returning();
    if (!row) throw problem("not_found", `No service ${input.service.id}.`);
    return recordEvent(tx, {
      projectId: row.projectId,
      actorType: "user",
      actorId: input.actorId,
      type: "service.deleted",
      data: toService(row, input.appsDomain, fields),
    });
  });
}
