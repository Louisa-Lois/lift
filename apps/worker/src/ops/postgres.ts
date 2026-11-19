import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import type { ProvisionContext } from "@lift/shared";
import type { Sql } from "postgres";

/** A user database and its role are both named after the database ID: `db_` and 24 characters. */
const NAME = /^db_[a-z0-9]{24}$/;
const SCRAM_ITERATIONS = 4096;

/**
 * The SCRAM-SHA-256 verifier Postgres keeps for a password (RFC 5802 and 7677), in the form
 * `SCRAM-SHA-256$iterations:salt$StoredKey:ServerKey`. Postgres stores a verifier it is given as
 * it is, so the worker sends this, never the password: no statement, error or Postgres log line
 * ever holds the password itself.
 */
export function scramVerifier(
  password: string,
  salt: Buffer = randomBytes(16),
  iterations = SCRAM_ITERATIONS,
): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/**
 * Runs one DDL statement. DDL takes no bind parameters, so Postgres builds it with `format`: `%I`
 * quotes a name and `%L` a literal, on the server.
 */
async function ddl(sql: Sql, template: string, ...args: string[]): Promise<void> {
  const placeholders = args.map((_, index) => `$${index + 2}::text`).join(", ");
  const [row] = await sql.unsafe<{ statement: string }[]>(
    `select format($1::text, ${placeholders}) as statement`,
    [template, ...args],
  );
  if (!row) throw new Error("format returned no statement");
  await sql.unsafe(row.statement);
}

function checkName(name: string | null): string {
  if (!name || !NAME.test(name)) {
    throw new Error("a user database and its role are named after a database ID");
  }
  return name;
}

const ROLE_OPTIONS =
  "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 20";

/**
 * Creates a project's database and its login role on the shared Postgres, as its superuser
 * (INF-10). Only that role may connect to that database: PUBLIC loses CONNECT on it, and on
 * `postgres` and `template1`, so one project's credentials never reach another's data (lift-pg's
 * pg_hba.conf allows each role only its own database too). Safe to run again: the role gets the
 * password again, and an existing database is kept.
 */
export async function provisionPostgres(
  sql: Sql,
  context: Pick<ProvisionContext, "dbName" | "username" | "password">,
): Promise<void> {
  const database = checkName(context.dbName);
  const role = checkName(context.username);
  const verifier = scramVerifier(context.password);
  const [roleExists] = await sql`select 1 from pg_roles where rolname = ${role}`;
  await ddl(
    sql,
    `${roleExists ? "ALTER" : "CREATE"} ROLE %I WITH ${ROLE_OPTIONS} PASSWORD %L`,
    role,
    verifier,
  );
  const [databaseExists] = await sql`select 1 from pg_database where datname = ${database}`;
  if (!databaseExists) await ddl(sql, "CREATE DATABASE %I OWNER %I", database, role);
  for (const name of [database, "postgres", "template1"]) {
    await ddl(sql, "REVOKE CONNECT ON DATABASE %I FROM PUBLIC", name);
  }
}

/** Drops a project's database, closing its connections first, then its role. Safe to run again. */
export async function deprovisionPostgres(sql: Sql, databaseId: string): Promise<void> {
  const name = checkName(databaseId);
  await ddl(sql, "DROP DATABASE IF EXISTS %I WITH (FORCE)", name);
  await ddl(sql, "DROP ROLE IF EXISTS %I", name);
}
