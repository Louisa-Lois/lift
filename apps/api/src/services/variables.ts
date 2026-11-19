import { type Db, schema } from "@lift/db";
import {
  isReservedVariableKey,
  maskVariableValue,
  newId,
  type RuntimeEnvVariable,
  StoredVariableSource,
  type Variable,
} from "@lift/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { SecretBox } from "./crypto";
import { type DbOrTx, type EventRow, recordEvent } from "./events";
import type { ServiceRow } from "./services";

export type VariableRow = typeof schema.variables.$inferSelect;

const v = schema.variables;

/** Stored variables come from a user, a database or the agent; `system` ones are never stored. */
function storedSource(row: VariableRow) {
  return StoredVariableSource.parse(row.source);
}

export function toVariable(row: VariableRow, value: string): Variable {
  return {
    id: row.id,
    serviceId: row.serviceId,
    key: row.key,
    value,
    source: storedSource(row),
    databaseId: row.databaseId,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

async function rowsOf(db: DbOrTx, serviceId: string): Promise<VariableRow[]> {
  return db.select().from(v).where(eq(v.serviceId, serviceId)).orderBy(asc(v.key));
}

/**
 * A service's variables by key (docs/prd/01-backend-api.md, "Variables"): values masked as `••••`
 * and their last 4 characters, unless `reveal` (editors only).
 */
export async function listVariables(
  db: DbOrTx,
  secretBox: SecretBox,
  serviceId: string,
  reveal: boolean,
): Promise<Variable[]> {
  return (await rowsOf(db, serviceId)).map((row) => {
    const value = secretBox.decrypt(row.valueEnc);
    return toVariable(row, reveal ? value : maskVariableValue(value));
  });
}

/**
 * `PUT /services/:id/variables` in one transaction: each key with a value is set as the user's (a
 * value a database wrote becomes the user's, so deleting the database leaves it), and each key
 * whose value is null is deleted. Changes are staged until the next deployment. Returns the
 * `variables.changed` event, which names the keys and never a value, or null when nothing changed.
 */
export async function upsertVariables(
  db: Db,
  input: {
    service: ServiceRow;
    secretBox: SecretBox;
    changes: Record<string, string | null>;
    actorId: string;
  },
): Promise<EventRow | null> {
  const { service, secretBox, changes } = input;
  return db.transaction(async (tx) => {
    const now = new Date();
    const changed = new Set<string>();
    const deletes: string[] = [];
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) {
        deletes.push(key);
        continue;
      }
      const valueEnc = secretBox.encrypt(value);
      await tx
        .insert(v)
        .values({
          id: newId("var"),
          serviceId: service.id,
          key,
          valueEnc,
          source: "user",
          databaseId: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [v.serviceId, v.key],
          set: { valueEnc, source: "user", databaseId: null, updatedAt: now },
        });
      changed.add(key);
    }
    if (deletes.length > 0) {
      const removed = await tx
        .delete(v)
        .where(and(eq(v.serviceId, service.id), inArray(v.key, deletes)))
        .returning({ key: v.key });
      for (const { key } of removed) changed.add(key);
    }
    if (changed.size === 0) return null;
    return recordEvent(tx, {
      projectId: service.projectId,
      actorType: "user",
      actorId: input.actorId,
      type: "variables.changed",
      data: { serviceId: service.id, keys: [...changed].sort() },
    });
  });
}

/**
 * A service's stored variables, decrypted, for the worker's `build-context` and `runtime-env`.
 * A reserved key (PORT, LIFT_*) can't be stored through the API; if one ever is, Lift's own wins.
 */
export async function decryptedVariables(
  db: DbOrTx,
  secretBox: SecretBox | null,
  serviceId: string,
): Promise<RuntimeEnvVariable[]> {
  const rows = (await rowsOf(db, serviceId)).filter((row) => !isReservedVariableKey(row.key));
  if (rows.length === 0) return [];
  if (!secretBox) throw new Error("variables are stored, but there is no ENCRYPTION_KEY");
  return rows.map((row) => ({
    key: row.key,
    value: secretBox.decrypt(row.valueEnc),
    source: storedSource(row),
  }));
}
