import { describe, expect, it } from "vitest";
import { formatBytes, timeAgo } from "@/lib/format";

const now = Date.parse("2026-11-19T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();
const MINUTE = 60_000;

describe("timeAgo", () => {
  it.each([
    [ago(30_000), "just now"],
    [ago(5 * MINUTE), "5m ago"],
    [ago(59 * MINUTE), "59m ago"],
    [ago(3 * 60 * MINUTE), "3h ago"],
    [ago(2 * 24 * 60 * MINUTE), "2d ago"],
  ])("shows %s as %s", (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });

  it("shows the date after 30 days", () => {
    expect(timeAgo("2026-09-15T12:00:00Z", now)).toBe("Sep 15, 2026");
  });

  it("treats a time slightly in the future (clock skew) as just now", () => {
    expect(timeAgo(new Date(now + 5_000).toISOString(), now)).toBe("just now");
  });
});

describe("formatBytes", () => {
  it.each([
    [940, "940 B"],
    [18_442, "18 KB"],
    [512 * 1024, "512 KB"],
    [2_500_000, "2.4 MB"],
  ])("%d bytes is %s", (bytes, label) => {
    expect(formatBytes(bytes)).toBe(label);
  });
});
