import { z } from "zod";

/**
 * Every variable the worker reads, validated once at startup. INF-04 adds CONTROL_API_URL,
 * WORKER_TOKEN, REDIS_URL, APPS_DOMAIN and BUILDKIT_HOST (see .env.example).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment for the worker:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
