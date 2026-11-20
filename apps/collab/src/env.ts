import { DEV_PORTS } from "@lift/shared";
import { z } from "zod";

/** An empty value in .env (`COLLAB_SECRET=`) counts as unset. */
const unsetIfEmpty = (value: unknown) => (value === "" ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(unsetIfEmpty, schema.optional());
const withDefault = <T extends z.ZodType>(schema: T, value: z.input<T>) =>
  z.preprocess(unsetIfEmpty, schema.default(value as never));

/**
 * Every variable the collab server reads, validated once at startup. Development falls back to
 * the local stack's Postgres, and without COLLAB_SECRET it refuses every connection. Production
 * needs both: see PRODUCTION_REQUIRED.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: optional(z.string().min(1)),
  COLLAB_PORT: z.coerce.number().int().min(0).max(65_535).default(DEV_PORTS.collab),
  /** Where each document's Yjs state lives (`editor_documents`). */
  DATABASE_URL: withDefault(z.url(), "postgres://lift:lift@localhost:5432/lift"),
  /**
   * Shared with the API, which signs the collab tokens with it and sends it to the internal
   * routes. The same rule as the API's secrets: `pnpm env:init` makes one this long or longer.
   */
  COLLAB_SECRET: optional(z.string().min(32, "must be at least 32 characters")),
});

/** Production never falls back to a default or runs without a secret. */
const PRODUCTION_REQUIRED = ["DATABASE_URL", "COLLAB_SECRET"] as const;

export type Env = z.infer<typeof EnvSchema> & { HOST: string };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment for the collab server:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  if (env.NODE_ENV === "production") {
    const missing = PRODUCTION_REQUIRED.filter((key) => !source[key]);
    if (missing.length > 0) {
      throw new Error(
        `Invalid environment for the collab server: production needs ${missing.join(", ")}`,
      );
    }
  }
  return { ...env, HOST: env.HOST ?? (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1") };
}
