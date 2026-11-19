import { type Env, loadEnv } from "../../src/env";

/**
 * The environment tests run with: the local stack's Postgres and Redis (or CI's, through
 * DATABASE_URL and REDIS_URL), silent logs, and any overrides.
 */
export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
    ...(process.env.REDIS_URL ? { REDIS_URL: process.env.REDIS_URL } : {}),
    ...overrides,
  });
}
