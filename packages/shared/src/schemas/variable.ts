import { z } from "zod";
import { VariableSource } from "../enums";
import { DatabaseId, ServiceId, VariableId } from "../ids";
import { Timestamp, VariableKey } from "./common";

/** Masked values are `••••` plus the last 4 characters (docs/prd/01-backend-api.md, "Variables"). */
export const VARIABLE_MASK = "••••";

export function maskVariableValue(value: string): string {
  return `${VARIABLE_MASK}${value.slice(-4)}`;
}

/** Injected at runtime and never stored: users can't set `PORT` or any key starting `LIFT_`. */
export const SYSTEM_VARIABLE_KEYS = [
  "PORT",
  "LIFT_SERVICE_ID",
  "LIFT_DEPLOYMENT_ID",
  "LIFT_PUBLIC_URL",
] as const;
export const RESERVED_VARIABLE_PREFIX = "LIFT_";

export function isReservedVariableKey(key: string): boolean {
  return key === "PORT" || key.startsWith(RESERVED_VARIABLE_PREFIX);
}

export const VARIABLE_VALUE_MAX_LENGTH = 32 * 1024;

/** Stored variables come from a user, a database or the agent, never `system`. */
export const StoredVariableSource = VariableSource.exclude(["system"]);
export type StoredVariableSource = z.infer<typeof StoredVariableSource>;

/**
 * `GET /services/:id/variables`: values masked unless `?reveal=true` (editor role). Changes are
 * staged: they apply on the next deployment.
 */
export const Variable = z.object({
  id: VariableId,
  serviceId: ServiceId,
  key: VariableKey,
  value: z.string(),
  source: StoredVariableSource,
  /** The database this value came from, when `source` is `database`. */
  databaseId: DatabaseId.nullable(),
  updatedAt: Timestamp,
  createdAt: Timestamp,
});
export type Variable = z.infer<typeof Variable>;

export const VariablesQuery = z.object({ reveal: z.stringbool().default(false) });
export type VariablesQuery = z.infer<typeof VariablesQuery>;

/** `PUT /services/:id/variables`: bulk upsert; `null` deletes a key. */
export const UpsertVariablesBody = z
  .strictObject({
    variables: z.record(VariableKey, z.string().max(VARIABLE_VALUE_MAX_LENGTH).nullable()),
  })
  .superRefine((body, ctx) => {
    const keys = Object.keys(body.variables);
    if (keys.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Set or delete at least one variable",
        path: ["variables"],
      });
    }
    for (const key of keys) {
      if (isReservedVariableKey(key)) {
        ctx.addIssue({
          code: "custom",
          message: `${key} is set by Lift. Change the service's port setting instead of PORT; keys starting LIFT_ are reserved.`,
          path: ["variables", key],
        });
      }
    }
  });
export type UpsertVariablesBody = z.infer<typeof UpsertVariablesBody>;

/** Every variable of the service after the change (masked), and a reminder to redeploy. */
export const UpsertVariablesResponse = z.object({
  variables: z.array(Variable),
  requiresRedeploy: z.literal(true),
});
export type UpsertVariablesResponse = z.infer<typeof UpsertVariablesResponse>;
