import { DEV_PORTS } from "@lift/shared";
import { z } from "zod";

/**
 * Every variable the API reads, validated once at startup; the process refuses to start on bad
 * config. BE-01 adds the rest of the API's variables listed in .env.example.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  HOST: z.string().min(1).optional(),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(DEV_PORTS.api),
});

export type Env = z.infer<typeof EnvSchema> & { HOST: string };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment for the API:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  // Inside a container the server must listen on every interface; on a laptop, only on loopback.
  return { ...env, HOST: env.HOST ?? (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1") };
}
