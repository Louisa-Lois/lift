import { INVITE_ONLY_PROBLEM_TYPE } from "@lift/shared";
import { describe, expect, it } from "vitest";
import { loginUrl, safeNext } from "@/lib/auth";

describe("safeNext", () => {
  it("keeps paths on this site and drops everything else", () => {
    expect(safeNext("/p/prj_abc?tab=logs")).toBe("/p/prj_abc?tab=logs");
    expect(safeNext("//evil.example")).toBeUndefined();
    expect(safeNext("https://evil.example")).toBeUndefined();
    expect(safeNext("/\\evil.example")).toBeUndefined();
    expect(safeNext(null)).toBeUndefined();
  });
});

describe("loginUrl", () => {
  it("comes back to where you were", () => {
    expect(loginUrl("/p/prj_abc?tab=logs")).toBe("/login?next=%2Fp%2Fprj_abc%3Ftab%3Dlogs");
  });

  it("says why when the login is no longer invited", () => {
    expect(loginUrl("/projects", INVITE_ONLY_PROBLEM_TYPE)).toBe(
      "/login?next=%2Fprojects&error=invite_only",
    );
    expect(loginUrl("/projects", "about:blank")).toBe("/login?next=%2Fprojects");
  });

  it("never loops back to /login or leaves the site", () => {
    expect(loginUrl("/login")).toBe("/login");
    expect(loginUrl("//evil.example")).toBe("/login");
  });
});
