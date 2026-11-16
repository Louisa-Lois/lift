import { DEV_PORTS } from "@lift/shared";
import { z } from "zod";

/**
 * Every variable the agent service reads, validated once at startup. AI-01 adds API_URL,
 * AGENT_SERVICE_TOKEN, ANTHROPIC_API_KEY and REDIS_URL (see .env.example).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  HOST: z.string().min(1).optional(),
  AGENT_PORT: z.coerce.number().int().min(1).max(65_535).default(DEV_PORTS.agent),
});

export type Env = z.infer<typeof EnvSchema> & { HOST: string };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment for the agent service:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  return { ...env, HOST: env.HOST ?? (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1") };
}
