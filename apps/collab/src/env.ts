import { DEV_PORTS } from "@lift/shared";
import { z } from "zod";

/**
 * Every variable the collab server reads, validated once at startup. BE-17 adds DATABASE_URL and
 * COLLAB_SECRET (see .env.example).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).optional(),
  COLLAB_PORT: z.coerce.number().int().min(0).max(65_535).default(DEV_PORTS.collab),
});

export type Env = z.infer<typeof EnvSchema> & { HOST: string };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment for the collab server:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  return { ...env, HOST: env.HOST ?? (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1") };
}
