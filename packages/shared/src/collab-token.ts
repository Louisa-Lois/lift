/**
 * @lift/shared/collab-token: the live editor's token (PRD 01, "Live editor back end"), an HS256
 * JWT signed with COLLAB_SECRET. The API signs it and the collab server checks it; the browser
 * only passes it on. It uses Web Crypto, like the rest of this package, so it runs anywhere, but
 * it has its own entry point: nothing in the web app needs it.
 */
import { CollabTokenClaims } from "./schemas/editor";

/** A token lasts 10 minutes; the editor asks for a fresh one on every connect. */
export const COLLAB_TOKEN_TTL_SECONDS = 600;

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

const json = (value: object) => base64url(encoder.encode(JSON.stringify(value)));
/** The only header Lift signs or accepts, so a token can't choose its own algorithm. */
const HEADER = json({ alg: "HS256", typ: "JWT" });

const hmacKey = (secret: string, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    usage,
  ]);

export async function signCollabToken(
  claims: Omit<CollabTokenClaims, "exp">,
  secret: string,
  now: number = Date.now(),
): Promise<string> {
  const payload = json({ ...claims, exp: Math.floor(now / 1000) + COLLAB_TOKEN_TTL_SECONDS });
  const input = `${HEADER}.${payload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, "sign"),
    encoder.encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

/**
 * The claims of a token signed with `secret` that hasn't expired, or null. Web Crypto's verify
 * compares the signature in constant time.
 */
export async function verifyCollabToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): Promise<CollabTokenClaims | null> {
  const [header, payload, signature, ...rest] = token.split(".");
  if (header !== HEADER || !payload || !signature || rest.length > 0) return null;
  const given = fromBase64url(signature);
  if (!given) return null;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    given,
    encoder.encode(`${header}.${payload}`),
  );
  if (!valid) return null;
  const bytes = fromBase64url(payload);
  if (!bytes) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  const parsed = CollabTokenClaims.safeParse(claims);
  if (!parsed.success || parsed.data.exp * 1000 <= now) return null;
  return parsed.data;
}
