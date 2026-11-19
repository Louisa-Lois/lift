import { DEV_PORTS, SERVICE_TOKEN_PATTERN } from "@lift/shared";
import { z } from "zod";

/** An empty value in .env (`ANTHROPIC_API_KEY=`) counts as unset. */
const unsetIfEmpty = (value: unknown) => (value === "" ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(unsetIfEmpty, schema.optional());
const withDefault = <T extends z.ZodType>(schema: T, value: z.input<T>) =>
  z.preprocess(unsetIfEmpty, schema.default(value as never));

/**
 * Every variable the agent service reads, validated once at startup. In development the URLs fall
 * back to the local stack and the secrets may be missing: planning then answers 503.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  HOST: z.string().min(1).optional(),
  AGENT_PORT: z.coerce.number().int().min(1).max(65_535).default(DEV_PORTS.agent),
  /** The API, which the agent calls as a user with AGENT_SERVICE_TOKEN and X-Lift-Act-As. */
  API_URL: withDefault(z.url(), `http://localhost:${DEV_PORTS.api}`),
  /** Shared with the API: it calls this service with it, and this service calls the API with it. */
  AGENT_SERVICE_TOKEN: optional(
    z.string().regex(SERVICE_TOKEN_PATTERN, "must be lift_svc_ plus 32 base64url characters"),
  ),
  /** Only this service reads it. */
  ANTHROPIC_API_KEY: optional(z.string().min(1)),
  /** Where the daily token budgets are counted. */
  REDIS_URL: withDefault(z.string().min(1), "redis://localhost:6379"),
  /** Input tokens a project, or a user planning a repo, may spend per UTC day (PRD 03). */
  AGENT_DAILY_TOKEN_BUDGET: withDefault(z.coerce.number().int().min(1), 300_000),
});

/** Production refuses to start without these. */
const PRODUCTION_REQUIRED = ["API_URL", "AGENT_SERVICE_TOKEN", "ANTHROPIC_API_KEY", "REDIS_URL"];

export type Env = z.infer<typeof EnvSchema> & { HOST: string };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment for the agent service:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  if (env.NODE_ENV === "production") {
    const missing = PRODUCTION_REQUIRED.filter((key) => !source[key]);
    if (missing.length > 0) {
      throw new Error(
        `Invalid environment for the agent service: production needs ${missing.join(", ")}`,
      );
    }
  }
  return { ...env, HOST: env.HOST ?? (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1") };
}
