import { describe, expect, it } from "vitest";
import { COLLAB_TOKEN_TTL_SECONDS, signCollabToken, verifyCollabToken } from "../src/collab-token";

const SECRET = "s".repeat(64);
const claims = {
  sub: "usr_aaaaaaaaaaaaaaaaaaaaaaaa",
  svc: "svc_bbbbbbbbbbbbbbbbbbbbbbbb",
  path: "src/server.js",
  role: "editor" as const,
};
const now = Date.UTC(2026, 10, 26, 12, 0, 0);
const base64url = (value: object) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

describe("the collab token", () => {
  it("carries its claims for 10 minutes", async () => {
    const token = await signCollabToken(claims, SECRET, now);
    expect(await verifyCollabToken(token, SECRET, now)).toEqual({
      ...claims,
      exp: now / 1000 + COLLAB_TOKEN_TTL_SECONDS,
    });
    expect(
      await verifyCollabToken(token, SECRET, now + COLLAB_TOKEN_TTL_SECONDS * 1000),
    ).toBeNull();
  });

  it("is a standard HS256 JWT", async () => {
    const [header, payload] = (await signCollabToken(claims, SECRET, now)).split(".");
    expect(JSON.parse(atob(header ?? ""))).toEqual({ alg: "HS256", typ: "JWT" });
    expect(JSON.parse(atob((payload ?? "").replace(/-/g, "+").replace(/_/g, "/")))).toMatchObject(
      claims,
    );
  });

  it("is refused when signed with another secret, changed, or with another algorithm", async () => {
    const token = await signCollabToken(claims, SECRET, now);
    expect(await verifyCollabToken(token, "t".repeat(64), now)).toBeNull();
    const [header, payload, signature] = token.split(".");
    const forged = base64url({ ...claims, role: "owner", exp: now / 1000 + 600 });
    expect(await verifyCollabToken(`${header}.${forged}.${signature}`, SECRET, now)).toBeNull();
    const none = base64url({ alg: "none", typ: "JWT" });
    expect(await verifyCollabToken(`${none}.${payload}.`, SECRET, now)).toBeNull();
    expect(await verifyCollabToken(`${header}.${payload}.!!!`, SECRET, now)).toBeNull();
    expect(await verifyCollabToken(`${token}.extra`, SECRET, now)).toBeNull();
    expect(await verifyCollabToken("not-a-token", SECRET, now)).toBeNull();
  });
});
