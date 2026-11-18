import { z } from "zod";
import { DatabaseStatus, DatabaseType } from "../enums";
import { DatabaseId, ProjectId } from "../ids";
import { Port, ResourceName, Timestamp, VariableKey } from "./common";

/** The variable a database's connection string is written to, unless the plan names another. */
export const DEFAULT_DATABASE_ENV_VARS = {
  postgres: "DATABASE_URL",
  redis: "REDIS_URL",
} as const satisfies Record<DatabaseType, string>;

/**
 * A Postgres or Redis database for a project. When it is ready, the API writes its connection
 * string into `envVar` on every service in the project (unless a user set that key), with
 * `source: database` and this database's ID, and removes those variables when it is deleted.
 */
export const Database = z.object({
  id: DatabaseId,
  projectId: ProjectId,
  type: DatabaseType,
  name: ResourceName,
  status: DatabaseStatus,
  /** Reachable only inside the project's network, e.g. `lift-pg`. Null until ready. */
  host: z.string().nullable(),
  port: Port.nullable(),
  envVar: VariableKey,
  createdAt: Timestamp,
});
export type Database = z.infer<typeof Database>;

/** `POST /projects/:id/databases` → 202 with the database `provisioning`. Name defaults to the type. */
export const CreateDatabaseBody = z.strictObject({
  type: DatabaseType,
  name: ResourceName.optional(),
});
export type CreateDatabaseBody = z.infer<typeof CreateDatabaseBody>;

/** `GET /databases/:id/credentials` (editor role). Redis has no username or database name. */
export const DatabaseCredentials = z.object({
  url: z.url(),
  host: z.string().min(1),
  port: Port,
  username: z.string().nullable(),
  password: z.string().min(1),
  database: z.string().nullable(),
});
export type DatabaseCredentials = z.infer<typeof DatabaseCredentials>;
