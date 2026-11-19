import { describe, expect, it } from "vitest";
import { parseGithubRepo } from "@/lib/github-url";

describe("parseGithubRepo", () => {
  it.each([
    ["https://github.com/lift-demo/next-hello", "lift-demo", "next-hello"],
    ["https://github.com/lift-demo/next-hello.git", "lift-demo", "next-hello"],
    ["http://www.github.com/lift-demo/next-hello/", "lift-demo", "next-hello"],
    ["github.com/lift-demo/next-hello/tree/main/apps/web", "lift-demo", "next-hello"],
    ["https://github.com/lift-demo/next-hello?tab=readme-ov-file", "lift-demo", "next-hello"],
    ["https://github.com/lift-demo/next-hello#readme", "lift-demo", "next-hello"],
    ["git@github.com:lift-demo/next-hello.git", "lift-demo", "next-hello"],
    ["  lift-demo/next-hello  ", "lift-demo", "next-hello"],
    ["Ama-Owusu/Portfolio.v2", "Ama-Owusu", "Portfolio.v2"],
  ])("reads %s", (input, owner, name) => {
    expect(parseGithubRepo(input)).toEqual({ owner, name });
  });

  it.each([
    "next-hello",
    "",
    "https://github.com/lift-demo",
    "https://gitlab.com/lift-demo/next-hello",
    "lift-demo/next-hello/extra",
    "-bad-owner/repo",
    "owner/bad name",
  ])("refuses %j", (input) => {
    expect(parseGithubRepo(input)).toBeNull();
  });
});
