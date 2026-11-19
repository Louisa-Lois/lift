import { createTestDatabase, type TestDatabase } from "@lift/db/testing";
import { buildServer, type ServerOptions } from "../../src/server";
import { testEnv } from "./env";

/** A fixed 32-byte key, so tests can decrypt what the API stored. */
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

/** The agent service's token (AGENT_SERVICE_TOKEN) in tests. */
export const TEST_AGENT_TOKEN = `lift_svc_${"a".repeat(32)}`;

/**
 * Settings every signed-in test needs: GitHub OAuth, encryption, the cookie secret and the agent
 * service's token.
 */
export const AUTH_ENV = {
  AGENT_SERVICE_TOKEN: TEST_AGENT_TOKEN,
  ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  SESSION_SECRET: "t".repeat(64),
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
};

/** An API on an existing test database. */
export async function buildTestApp(
  database: TestDatabase,
  env: Record<string, string> = {},
  options: ServerOptions = {},
) {
  const app = buildServer(testEnv({ DATABASE_URL: database.url, ...AUTH_ENV, ...env }), options);
  await app.ready();
  return app;
}

/** A fresh migrated database and an API on it; `close()` removes both. */
export async function createTestApp(env: Record<string, string> = {}, options: ServerOptions = {}) {
  const database = await createTestDatabase();
  const app = await buildTestApp(database, env, options);
  return {
    app,
    database,
    db: database.db,
    async close() {
      await app.close();
      await database.drop();
    },
  };
}
