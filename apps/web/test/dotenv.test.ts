import { describe, expect, it } from "vitest";
import { changesFor, diffVariables, parseDotenv, printDotenv } from "@/lib/dotenv";

describe("parseDotenv", () => {
  it("reads bare, quoted and exported values, skipping comments and blank lines", () => {
    const text = [
      "# The shop's settings",
      "",
      "NODE_ENV=production",
      "export API_URL=https://api.example.com # the public API",
      "GREETING='Hello # not a comment'",
      'MULTI="line one\\nline two \\"quoted\\""',
      "EMPTY=",
      "NODE_ENV=staging",
    ].join("\n");
    expect(parseDotenv(text)).toEqual({
      values: {
        NODE_ENV: "staging",
        API_URL: "https://api.example.com",
        GREETING: "Hello # not a comment",
        MULTI: 'line one\nline two "quoted"',
        EMPTY: "",
      },
      errors: [],
    });
  });

  it("names each line it can't read", () => {
    const { values, errors } = parseDotenv(
      [
        "OK=1",
        "no equals sign",
        "lower_case=x",
        "PORT=3000",
        "LIFT_TOKEN=x",
        'OPEN="never closed',
      ].join("\n"),
    );
    expect(values).toEqual({ OK: "1" });
    expect(errors).toEqual([
      { line: 2, message: "Expected KEY=value" },
      { line: 3, message: "lower_case isn't a valid key: use A-Z, 0-9 and _, like DATABASE_URL" },
      { line: 4, message: "PORT is set by Lift" },
      { line: 5, message: "LIFT_TOKEN is set by Lift" },
      { line: 6, message: "This value's quote isn't closed" },
    ]);
  });
});

describe("printDotenv", () => {
  it("quotes only what needs it, and reads back the same", () => {
    const values = {
      PLAIN: "abc123",
      SPACED: "two words",
      QUOTED: 'say "hi"',
      NEWLINE: "a\nb",
      HASH: "x#y",
      EMPTY: "",
    };
    const text = printDotenv(values);
    expect(text.split("\n")).toEqual([
      'EMPTY=""',
      'HASH="x#y"',
      'NEWLINE="a\\nb"',
      "PLAIN=abc123",
      'QUOTED="say \\"hi\\""',
      'SPACED="two words"',
    ]);
    expect(parseDotenv(text)).toEqual({ values, errors: [] });
  });
});

describe("diffVariables", () => {
  it("lists added, changed and removed keys, and the body that applies them", () => {
    const current = { KEEP: "1", CHANGE: "old", DROP: "x" };
    const next = { KEEP: "1", CHANGE: "new", ADD: "y" };
    const diff = diffVariables(current, next);
    expect(diff).toEqual({ added: ["ADD"], changed: ["CHANGE"], removed: ["DROP"] });
    expect(changesFor(diff, next)).toEqual({ ADD: "y", CHANGE: "new", DROP: null });
  });
});
