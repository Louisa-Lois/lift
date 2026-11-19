#!/usr/bin/env node
// `pnpm env:init`: creates .env at the repo root from .env.example, generating every value marked
// __generate__. Safe to re-run: it never changes a value you set. It generates any value still
// marked __generate__ (a .env copied by hand from .env.example), appends variables .env.example
// has gained since your .env was made, and keeps .env readable only by you. It prints key names,
// never values.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const examplePath = path.join(root, ".env.example");
const envPath = path.join(root, ".env");

const keyOf = (line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1];
const isPlaceholder = (line) => {
  const key = keyOf(line);
  return Boolean(key) && line.trim() === `${key}=__generate__`;
};

function generate(key) {
  if (key === "ENCRYPTION_KEY") return randomBytes(32).toString("base64"); // AES-256 needs 32 bytes
  if (key === "AGENT_SERVICE_TOKEN") return `lift_svc_${randomBytes(24).toString("base64url")}`;
  return randomBytes(32).toString("base64url");
}

const fill = (line) => (isPlaceholder(line) ? `${keyOf(line)}=${generate(keyOf(line))}` : line);

const exampleLines = readFileSync(examplePath, "utf8").split("\n");

if (!existsSync(envPath)) {
  writeFileSync(envPath, exampleLines.map(fill).join("\n"), { mode: 0o600 });
  console.log("Created .env with fresh development secrets.");
} else {
  const lines = readFileSync(envPath, "utf8").split("\n");
  const generated = lines.filter(isPlaceholder).map(keyOf);
  const present = new Set(lines.map(keyOf).filter(Boolean));
  const missing = exampleLines.filter((line) => {
    const key = keyOf(line);
    return key && !present.has(key);
  });
  if (generated.length === 0 && missing.length === 0) {
    console.log(".env already has every variable in .env.example.");
  } else {
    let text = lines.map(fill).join("\n");
    if (missing.length > 0) {
      text = `${text.replace(/\n*$/, "\n")}\n# Added by pnpm env:init\n${missing.map(fill).join("\n")}\n`;
    }
    writeFileSync(envPath, text);
    if (generated.length > 0) console.log(`Generated in .env: ${generated.join(", ")}`);
    if (missing.length > 0) console.log(`Added to .env: ${missing.map(keyOf).join(", ")}`);
  }
}

// Development secrets still deserve a private file.
if ((statSync(envPath).mode & 0o077) !== 0) {
  chmodSync(envPath, 0o600);
  console.log("Made .env readable by you only (mode 600).");
}

const env = readFileSync(envPath, "utf8");
const empty = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "ANTHROPIC_API_KEY"].filter(
  (key) => !new RegExp(`^${key}=\\S`, "m").test(env),
);
if (empty.length > 0) {
  console.log(`Fill these in by hand when you need them: ${empty.join(", ")} (see .env.example).`);
}
