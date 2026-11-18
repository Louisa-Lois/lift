import { afterEach, describe, expect, it, vi } from "vitest";
import { ID_PREFIXES, ID_RANDOM_LENGTH, idSchema, isId, newId, ServiceId } from "../src/ids";

const prefixes = Object.values(ID_PREFIXES);

describe("newId", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(prefixes)("makes %s_ plus 24 lowercase letters and digits", (prefix) => {
    expect(newId(prefix)).toMatch(new RegExp(`^${prefix}_[a-z0-9]{24}$`));
  });

  it("never repeats across 100,000 IDs", () => {
    const ids = new Set(Array.from({ length: 100_000 }, () => newId("dep")));
    expect(ids.size).toBe(100_000);
  });

  it("uses all 36 letters and digits", () => {
    const characters = new Set(
      Array.from({ length: 2_000 }, () => newId("svc").slice("svc_".length)).join(""),
    );
    expect(characters.size).toBe(36);
  });

  it("draws its randomness from crypto.getRandomValues, which Node and browsers both have", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    newId("usr");
    expect(spy).toHaveBeenCalled();
  });

  it("skips the bytes that would bias the alphabet", () => {
    // 252 and above would make "a" to "d" more likely than the rest, so they are thrown away.
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementationOnce(<T>(array: T) => {
      (array as Uint8Array).fill(255);
      (array as Uint8Array)[0] = 0;
      return array;
    });
    const id = newId("prj");
    expect(id.startsWith("prj_a")).toBe(true);
    expect(id).toMatch(/^prj_[a-z0-9]{24}$/);
  });
});

describe("prefixes", () => {
  it("cover every entity in the data model plus the five agreed in BE-00", () => {
    expect([...prefixes].sort()).toEqual(
      [
        ...["usr", "prj", "svc", "dep", "var", "db", "dom", "evt", "tok", "pln", "ags", "act"],
        ...["edoc", "evr", "evx"],
        ...["cli", "dpe", "ecm", "msg", "dgn"],
      ].sort(),
    );
  });

  it("are unique lowercase words, so IDs stay valid Postgres identifiers", () => {
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const prefix of prefixes) expect(prefix).toMatch(/^[a-z]+$/);
  });
});

describe("validating IDs", () => {
  const id = newId("svc");

  it("accepts an ID with the expected prefix", () => {
    expect(ServiceId.parse(id)).toBe(id);
    expect(isId("svc", id)).toBe(true);
  });

  it.each([
    ["another prefix", id.replace("svc_", "dep_")],
    ["upper case", id.toUpperCase()],
    ["one character short", id.slice(0, -1)],
    ["one character long", `${id}a`],
    ["a hyphen", `svc_${"a".repeat(ID_RANDOM_LENGTH - 1)}-`],
    ["no underscore", id.replace("_", "")],
  ])("rejects %s", (_label, value) => {
    expect(idSchema("svc").safeParse(value).success).toBe(false);
    expect(isId("svc", value)).toBe(false);
  });
});
