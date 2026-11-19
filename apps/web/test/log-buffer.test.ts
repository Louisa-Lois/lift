import type { LogEntry } from "@lift/shared";
import { describe, expect, it } from "vitest";
import { appendLines, compareEntryIds } from "@/lib/log-buffer";

const line = (id: string, text = `line ${id}`): LogEntry => ({
  id,
  ts: "2026-11-21T09:00:00.000Z",
  stream: "build",
  line: text,
});

describe("the log buffer", () => {
  it("keeps lines in order", () => {
    const first = appendLines([], [line("1-0"), line("1-1")]);
    expect(appendLines(first, [line("2-0")]).map((entry) => entry.id)).toEqual([
      "1-0",
      "1-1",
      "2-0",
    ]);
  });

  it("skips lines it already has, so a resumed or replayed stream never repeats one", () => {
    const held = [line("5-0"), line("5-1")];
    const replayed = appendLines(held, [line("4-9"), line("5-0"), line("5-1"), line("5-2")]);
    expect(replayed.map((entry) => entry.id)).toEqual(["5-0", "5-1", "5-2"]);
    expect(appendLines(held, [line("5-1")])).toBe(held);
  });

  it("keeps only the newest lines past the cap", () => {
    const many = Array.from({ length: 12 }, (_, index) => line(`${index + 1}-0`));
    expect(appendLines([], many, 10).map((entry) => entry.id)).toEqual(
      many.slice(2).map((entry) => entry.id),
    );
  });

  it("orders stream IDs by time, then sequence", () => {
    expect(compareEntryIds("1763301900000-1", "1763301900000-0")).toBeGreaterThan(0);
    expect(compareEntryIds("999-5", "1000-0")).toBeLessThan(0);
    expect(compareEntryIds("7-3", "7-3")).toBe(0);
  });
});
