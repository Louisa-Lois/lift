import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const Secret = z.string().min(32, "must be at least 32 characters");

/**
 * Every variable the worker reads, validated once at startup (see .env.example). In development
 * everything falls back to the local stack, and a missing WORKER_TOKEN only keeps the worker
 * idle, so teammates' `pnpm dev` keeps working. Production refuses to start without it.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** The control plane's API: its private IP in production, never the public URL. */
    CONTROL_API_URL: z.url().default("http://localhost:4000"),
    WORKER_TOKEN: Secret.optional(),
    /** The control plane's Redis: the job queues and the log streams. */
    REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
    APPS_DOMAIN: z.string().min(1).default("apps.localhost"),
    BUILDKIT_HOST: z.string().min(1).default("tcp://localhost:1234"),
    /** Where clones live during a build; /var/lib/lift/builds (mode 700) on the VM. */
    BUILD_DIR: z.string().min(1).optional(),
    BUILD_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
    /** Where health checks run from: a curl container on lift-edge (compose names it lift-probe). */
    PROBE_CONTAINER: z.string().min(1).default("lift-probe"),
    /**
     * lift-pg's superuser, which creates and drops users' databases (INF-10). worker.yml builds
     * it from LIFT_PG_PASSWORD; in development the stack's lift-pg answers on localhost:5433.
     */
    LIFT_PG_URL: z.string().min(1).optional(),
  })
  .superRefine((env, ctx) => {
    for (const key of ["WORKER_TOKEN", "LIFT_PG_URL"] as const) {
      if (env.NODE_ENV === "production" && !env[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: "required in production" });
      }
    }
  })
  .transform((env) => ({
    ...env,
    BUILD_DIR:
      env.BUILD_DIR ??
      (env.NODE_ENV === "production" ? "/var/lib/lift/builds" : path.join(tmpdir(), "lift-builds")),
  }));

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment for the worker:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
