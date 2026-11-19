import { DEV_PORTS, GithubLogin, Hostname, SERVICE_TOKEN_PATTERN } from "@lift/shared";
import { z } from "zod";

/** An empty value in .env (`GITHUB_CLIENT_ID=`) counts as unset. */
const unsetIfEmpty = (value: unknown) => (value === "" ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(unsetIfEmpty, schema.optional());
const withDefault = <T extends z.ZodType>(schema: T, value: z.input<T>) =>
  z.preprocess(unsetIfEmpty, schema.default(value as never));

/** `openssl rand -hex 32` and `pnpm env:init` both make values this long or longer. */
const Secret = z.string().min(32, "must be at least 32 characters");
const EncryptionKey = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, "must be base64")
  .refine((value) => Buffer.from(value, "base64").length === 32, {
    message: "must be exactly 32 bytes, base64 (openssl rand -base64 32)",
  });
const AgentServiceToken = z
  .string()
  .regex(SERVICE_TOKEN_PATTERN, "must be lift_svc_ plus 32 base64url characters");

/** `vitalik-hakim, Louisa-Lois` → ["vitalik-hakim", "louisa-lois"]: GitHub logins ignore case. */
const LoginList = z.preprocess(
  unsetIfEmpty,
  z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((login) => login.trim().toLowerCase())
        .filter((login) => login !== ""),
    )
    .pipe(z.array(GithubLogin)),
);

/**
 * Every variable the API reads, validated once at startup; the process refuses to start on bad
 * config. In development and tests the URLs fall back to the local stack and the secrets may be
 * missing, so `pnpm dev` starts before .env is complete (a feature that needs a missing value
 * says so when it's used). Production needs all of them: see PRODUCTION_REQUIRED.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  HOST: optional(z.string().min(1)),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(DEV_PORTS.api),
  DATABASE_URL: withDefault(z.url(), "postgres://lift:lift@localhost:5432/lift"),
  REDIS_URL: withDefault(z.url(), "redis://localhost:6379"),
  /** Where people open the dashboard; OAuth callbacks and links are built from it. */
  PUBLIC_URL: withDefault(z.url(), "http://localhost:3000"),
  /** Deployed apps get {service}-{project}.{APPS_DOMAIN}. */
  APPS_DOMAIN: withDefault(Hostname, "apps.localhost"),
  AGENT_URL: withDefault(z.url(), `http://localhost:${DEV_PORTS.agent}`),
  SESSION_SECRET: optional(Secret),
  ENCRYPTION_KEY: optional(EncryptionKey),
  WORKER_TOKEN: optional(Secret),
  AGENT_SERVICE_TOKEN: optional(AgentServiceToken),
  COLLAB_SECRET: optional(Secret),
  GITHUB_CLIENT_ID: optional(z.string().min(1)),
  GITHUB_CLIENT_SECRET: optional(z.string().min(1)),
  /**
   * Sign-in is invite-only: only these GitHub logins may sign in. Empty means anyone, which only
   * development and tests allow (a developer's own OAuth app is private anyway).
   */
  ALLOWED_GITHUB_LOGINS: LoginList,
});

/** Production never falls back to a default or runs without a secret. */
const PRODUCTION_REQUIRED = [
  "DATABASE_URL",
  "REDIS_URL",
  "PUBLIC_URL",
  "APPS_DOMAIN",
  "AGENT_URL",
  "SESSION_SECRET",
  "ENCRYPTION_KEY",
  "WORKER_TOKEN",
  "AGENT_SERVICE_TOKEN",
  "COLLAB_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "ALLOWED_GITHUB_LOGINS",
] as const;

export type Env = z.infer<typeof EnvSchema> & { HOST: string };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment for the API:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  if (env.NODE_ENV === "production") {
    const missing = PRODUCTION_REQUIRED.filter((key) => !source[key]);
    if (missing.length > 0) {
      throw new Error(`Invalid environment for the API: production needs ${missing.join(", ")}`);
    }
    if (env.ALLOWED_GITHUB_LOGINS.length === 0) {
      throw new Error("Invalid environment for the API: ALLOWED_GITHUB_LOGINS lists no logins");
    }
  }
  // Inside a container the server must listen on every interface; on a laptop, only on loopback.
  return { ...env, HOST: env.HOST ?? (env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1") };
}

/** Whether a GitHub login may sign in (case-insensitive); an empty list allows anyone. */
export function isAllowedLogin(env: Pick<Env, "ALLOWED_GITHUB_LOGINS">, login: string): boolean {
  const allowed = env.ALLOWED_GITHUB_LOGINS;
  return allowed.length === 0 || allowed.includes(login.toLowerCase());
}
