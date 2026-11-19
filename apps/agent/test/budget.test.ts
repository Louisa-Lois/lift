import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { budgetKey, redisBudget } from "../src/budget";

// Against the local stack's Redis (pnpm stack:up), like the API's tests.
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: 1,
});
const subject = { kind: "project" as const, id: `prj_test${Date.now()}` };
afterAll(async () => {
  await redis.del(budgetKey(subject));
  redis.disconnect();
});

describe("the daily budget in Redis", () => {
  it("adds up a subject's tokens for the UTC day, and expires them after two days", async () => {
    const budget = redisBudget(redis);
    expect(await budget.spent(subject)).toBe(0);
    await budget.add(subject, 1_200);
    await budget.add(subject, 800);
    expect(await budget.spent(subject)).toBe(2_000);
    expect(await budget.spent({ kind: "user", id: subject.id })).toBe(0);
    const ttl = await redis.ttl(budgetKey(subject));
    expect(ttl).toBeGreaterThan(24 * 60 * 60);
    expect(ttl).toBeLessThanOrEqual(2 * 24 * 60 * 60);
  });

  it("starts again each day", () => {
    expect(budgetKey(subject, new Date("2026-11-24T23:59:59Z"))).not.toBe(
      budgetKey(subject, new Date("2026-11-25T00:00:00Z")),
    );
  });
});
