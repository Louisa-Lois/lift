import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { schema } from "../src/index";
import { createTestDatabase, TEST_SERVER_URL } from "../src/testing";

describe("createTestDatabase", () => {
  const admin = postgres(TEST_SERVER_URL, { max: 1, onnotice: () => {} });
  afterAll(() => admin.end());

  it("creates a migrated database and drops it again", async () => {
    const test = await createTestDatabase();
    const name = new URL(test.url).pathname.slice(1);
    expect(name).toMatch(/^lift_test_[0-9a-f]{8}$/);
    await expect(test.db.select().from(schema.users)).resolves.toEqual([]);

    await test.drop();
    const rows = await admin`select 1 from pg_database where datname = ${name}`;
    expect(rows).toHaveLength(0);
  });
});
