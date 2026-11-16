#!/usr/bin/env node
// `pnpm env:init`: creates .env at the repo root from .env.example, generating every value marked
// __generate__. Safe to re-run: it never changes an existing value; it only appends variables that
// .env.example has gained since your .env was made.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const examplePath = path.join(root, ".env.example");
const envPath = path.join(root, ".env");

const keyOf = (line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1];

function generate(key) {
  if (key === "ENCRYPTION_KEY") return randomBytes(32).toString("base64"); // AES-256 needs 32 bytes
  if (key === "AGENT_SERVICE_TOKEN") return `lift_svc_${randomBytes(24).toString("base64url")}`;
  return randomBytes(32).toString("base64url");
}

function fill(line) {
  const key = keyOf(line);
  return key && line.trim() === `${key}=__generate__` ? `${key}=${generate(key)}` : line;
}

const exampleLines = readFileSync(examplePath, "utf8").split("\n");

if (!existsSync(envPath)) {
  writeFileSync(envPath, exampleLines.map(fill).join("\n"), { mode: 0o600 });
  console.log("Created .env with fresh development secrets.");
} else {
  const present = new Set(readFileSync(envPath, "utf8").split("\n").map(keyOf).filter(Boolean));
  const missing = exampleLines.filter((line) => {
    const key = keyOf(line);
    return key && !present.has(key);
  });
  if (missing.length === 0) {
    console.log(".env already has every variable in .env.example.");
  } else {
    appendFileSync(envPath, `\n# Added by pnpm env:init\n${missing.map(fill).join("\n")}\n`);
    console.log(`Added to .env: ${missing.map(keyOf).join(", ")}`);
  }
}

const env = readFileSync(envPath, "utf8");
const empty = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "ANTHROPIC_API_KEY"].filter(
  (key) => !new RegExp(`^${key}=\\S`, "m").test(env),
);
if (empty.length > 0) {
  console.log(`Fill these in by hand when you need them: ${empty.join(", ")} (see .env.example).`);
}
