import type { IdPrefix } from "../ids";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A xorshift32 stream seeded by FNV-1a of the label: random-looking, but the same every run. */
function seeded(label: string): () => number {
  let state = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    state ^= label.charCodeAt(i);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  if (state === 0) state = 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

/** A valid, stable ID for fixtures, so mock URLs and snapshots never change between runs. */
export function fixtureId<P extends IdPrefix>(prefix: P, label: string): `${P}_${string}` {
  const next = seeded(`${prefix}:${label}`);
  let body = "";
  for (let i = 0; i < 24; i++) body += ALPHABET.charAt(next() % ALPHABET.length);
  return `${prefix}_${body}`;
}

/** Stable lowercase hex, for commit SHAs, container IDs and hashes. */
export function fixtureHex(label: string, length: number): string {
  const next = seeded(`hex:${label}`);
  let hex = "";
  while (hex.length < length) hex += next().toString(16).padStart(8, "0");
  return hex.slice(0, length);
}

/** Every ID the demo project uses, for building URLs in mocks and tests. */
export const fixtureIds = {
  users: {
    owner: fixtureId("usr", "owner"),
    editor: fixtureId("usr", "editor"),
    viewer: fixtureId("usr", "viewer"),
  },
  project: fixtureId("prj", "demo-shop"),
  services: { web: fixtureId("svc", "web"), api: fixtureId("svc", "api") },
  database: fixtureId("db", "main-db"),
  domains: { web: fixtureId("dom", "web"), api: fixtureId("dom", "api") },
  deployments: {
    webFirst: fixtureId("dep", "web-first"),
    webFailed: fixtureId("dep", "web-failed"),
    webActive: fixtureId("dep", "web-active"),
    webCanceled: fixtureId("dep", "web-canceled"),
    webBuilding: fixtureId("dep", "web-building"),
    webQueued: fixtureId("dep", "web-queued"),
    apiFirst: fixtureId("dep", "api-first"),
    apiActive: fixtureId("dep", "api-active"),
    apiRollback: fixtureId("dep", "api-rollback"),
  },
  agentSessions: { autofix: fixtureId("ags", "autofix"), chat: fixtureId("ags", "chat") },
  agentActions: {
    setNodeVersion: fixtureId("act", "set-node-version"),
    addRedis: fixtureId("act", "add-redis"),
  },
  editorCommit: fixtureId("ecm", "hero-copy"),
  tokens: {
    laptop: fixtureId("tok", "laptop"),
    oldCi: fixtureId("tok", "old-ci"),
    created: fixtureId("tok", "created"),
  },
} as const;

/** The commits behind the demo deployments. */
export const fixtureCommits = {
  webInitial: {
    sha: fixtureHex("web-initial", 40),
    message: "Initial storefront",
    author: "ama-owusu",
  },
  webGrid: { sha: fixtureHex("web-grid", 40), message: "Add product grid", author: "kwame-asante" },
  webHeroTweak: {
    sha: fixtureHex("web-hero-tweak", 40),
    message: "Tweak hero copy",
    author: "ama-owusu",
  },
  webHero: { sha: fixtureHex("web-hero", 40), message: "Update hero copy", author: "kwame-asante" },
  webFooter: {
    sha: fixtureHex("web-footer", 40),
    message: "Fix footer links",
    author: "ama-owusu",
  },
  apiInitial: {
    sha: fixtureHex("api-initial", 40),
    message: "Express API with Postgres",
    author: "ama-owusu",
  },
  apiOrders: {
    sha: fixtureHex("api-orders", 40),
    message: "Add orders endpoint",
    author: "kwame-asante",
  },
} as const;
