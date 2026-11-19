import { randomBytes } from "node:crypto";
import { newId } from "@lift/shared";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deprovisionPostgres, provisionPostgres, scramVerifier } from "../src/ops/postgres";

// The stack's Postgres (pnpm stack:up), or CI's through DATABASE_URL, as its superuser: the test
// creates two databases and roles as the worker does on lift-pg, then drops them. It also revokes
// CONNECT from PUBLIC on `postgres` and `template1`, as provisioning does, which the stack's
// superuser doesn't need.
const adminUrl = (() => {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://lift:lift@localhost:5432/lift");
  url.pathname = "/postgres";
  return url;
})();

const quiet = { onnotice: () => undefined, max: 1, connect_timeout: 5 } as const;
const project = () => {
  const id = newId("db");
  return { dbName: id, username: id, password: randomBytes(18).toString("base64url") };
};
const A = project();
const B = project();
const statements: string[] = [];
let admin: Sql;

/** A connection as one project's role, to a database of the test's choosing. */
function connectAs(credentials: { username: string; password: string }, database: string): Sql {
  return postgres({
    host: adminUrl.hostname,
    port: Number(adminUrl.port || 5432),
    user: credentials.username,
    password: credentials.password,
    database,
    ...quiet,
  });
}

/** Connects, runs one query, and disconnects; rejects with Postgres's error if it can't. */
async function tryQuery(
  credentials: { username: string; password: string },
  database: string,
  query: (sql: Sql) => Promise<unknown> = (sql) => sql`select 1`,
): Promise<void> {
  const sql = connectAs(credentials, database);
  try {
    await query(sql);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

beforeAll(async () => {
  admin = postgres(adminUrl.toString(), {
    ...quiet,
    max: 2,
    debug: (_connection, query, parameters) => {
      statements.push(query, JSON.stringify(parameters));
    },
  });
  await provisionPostgres(admin, A);
  await provisionPostgres(admin, B);
}, 30_000);

afterAll(async () => {
  if (!admin) return;
  await deprovisionPostgres(admin, A.dbName).catch(() => undefined);
  await deprovisionPostgres(admin, B.dbName).catch(() => undefined);
  await admin.end({ timeout: 5 });
});

describe("a project's Postgres database", () => {
  it("lets its own role in, to create tables and keep data", async () => {
    await tryQuery(A, A.dbName, async (sql) => {
      await sql`create table orders (id int primary key)`;
      await sql`insert into orders values (1), (2)`;
      const [row] = await sql<{ n: number }[]>`select count(*)::int as n from orders`;
      expect(row?.n).toBe(2);
    });
  });

  it("can't be reached with another project's credentials", async () => {
    await expect(tryQuery(A, B.dbName)).rejects.toThrow(/permission denied for database/);
    await expect(tryQuery(B, A.dbName)).rejects.toThrow(/permission denied for database/);
    // Nor the shared server's own databases, where every database's name is listed.
    await expect(tryQuery(A, "postgres")).rejects.toThrow(/permission denied for database/);
    await expect(tryQuery(A, "template1")).rejects.toThrow(/permission denied for database/);
  });

  it("gives its role no power over the server", async () => {
    await expect(tryQuery(A, A.dbName, (sql) => sql`create role sneaky`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(tryQuery(A, A.dbName, (sql) => sql`create database sneaky`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      tryQuery(A, A.dbName, (sql) => sql.unsafe(`grant ${B.username} to ${A.username}`)),
    ).rejects.toThrow(/permission denied|must have admin option/);
  });

  it("is never sent the password itself, only a SCRAM verifier", () => {
    const sent = statements.join("\n");
    expect(sent).toContain("SCRAM-SHA-256$4096:");
    expect(sent).not.toContain(A.password);
    expect(sent).not.toContain(B.password);
  });

  it("can be provisioned again, keeping its data and its password", async () => {
    await provisionPostgres(admin, A);
    await tryQuery(A, A.dbName, async (sql) => {
      const [row] = await sql<{ n: number }[]>`select count(*)::int as n from orders`;
      expect(row?.n).toBe(2);
    });
  });

  it("leaves nothing behind when it's dropped", async () => {
    const C = project();
    await provisionPostgres(admin, C);
    await tryQuery(C, C.dbName);
    await deprovisionPostgres(admin, C.dbName);
    await deprovisionPostgres(admin, C.dbName);
    const roles = await admin`select 1 from pg_roles where rolname = ${C.username}`;
    const databases = await admin`select 1 from pg_database where datname = ${C.dbName}`;
    expect([roles.length, databases.length]).toEqual([0, 0]);
  });

  it("refuses names that aren't a database ID", async () => {
    await expect(
      provisionPostgres(admin, { dbName: "postgres", username: "postgres", password: "x" }),
    ).rejects.toThrow(/named after a database ID/);
    await expect(deprovisionPostgres(admin, "template1")).rejects.toThrow(/database ID/);
  });
});

describe("scramVerifier", () => {
  it("has the form Postgres stores, and a fresh salt each time", () => {
    const verifier = scramVerifier("hunter2-but-longer");
    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/,
    );
    expect(scramVerifier("hunter2-but-longer")).not.toBe(verifier);
    expect(verifier).not.toContain("hunter2");
  });
});
