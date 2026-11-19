import type { Redis } from "ioredis";

/** Who a model call is counted against: a project, or a user planning a repo before it has one. */
export interface BudgetSubject {
  kind: "project" | "user";
  id: string;
}

/** Input tokens spent per subject and UTC day (PRD 03: 300,000 a day per project by default). */
export interface Budget {
  spent(subject: BudgetSubject): Promise<number>;
  add(subject: BudgetSubject, tokens: number): Promise<void>;
}

/** Counters live a little over a day, so a day's total survives until the next one starts. */
const TTL_SECONDS = 2 * 24 * 60 * 60;

export function budgetKey(subject: BudgetSubject, now: Date = new Date()): string {
  return `lift:agent:tokens:${subject.kind}:${subject.id}:${now.toISOString().slice(0, 10)}`;
}

export function redisBudget(redis: Redis, now: () => Date = () => new Date()): Budget {
  return {
    async spent(subject) {
      return Number((await redis.get(budgetKey(subject, now()))) ?? 0);
    },
    async add(subject, tokens) {
      if (tokens <= 0) return;
      const key = budgetKey(subject, now());
      await redis.multi().incrby(key, tokens).expire(key, TTL_SECONDS).exec();
    },
  };
}
