import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createDb, type Db } from "./client";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** The Postgres from `pnpm stack:up`, unless DATABASE_URL points elsewhere (CI). */
export const TEST_SERVER_URL =
  process.env.DATABASE_URL ?? "postgres://lift:lift@localhost:5432/lift";

export interface TestDatabase {
  /** Connection URL of the new database. */
  url: string;
  db: Db;
  /** Closes the pool and drops the database. */
  drop: () => Promise<void>;
}

/**
 * For tests only: a throwaway database with every migration applied, on the same Postgres
 * server. Fails (never skips) when Postgres isn't reachable, so a missing stack can't hide a
 * broken test.
 */
export async function createTestDatabase(serverUrl = TEST_SERVER_URL): Promise<TestDatabase> {
  const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
  try {
    await admin`select 1`;
  } catch (error) {
    await admin.end();
    throw new Error(
      `Postgres isn't reachable at ${new URL(serverUrl).host}. Start it with \`pnpm stack:up\`.`,
      { cause: error },
    );
  }
  const name = `lift_test_${randomBytes(4).toString("hex")}`;
  await admin.unsafe(`create database ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;

  const migrator = postgres(url.toString(), { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(migrator), { migrationsFolder });
  } finally {
    await migrator.end();
  }

  const { db, close } = createDb(url.toString(), { max: 5 });
  return {
    url: url.toString(),
    db,
    drop: async () => {
      await close();
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}
