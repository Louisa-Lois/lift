import { z } from "zod";
import { HealthcheckPath, VariableKey } from "./schemas/common";
import type { StoredVariableSource } from "./schemas/variable";
import { isReservedVariableKey, VARIABLE_VALUE_MAX_LENGTH } from "./schemas/variable";
import { isPlaceholder, looksSecret } from "./secrets";

/**
 * What autofix may change by itself (AI-06). The agent uses these rules to decide what to ask
 * for, and the API checks every change against them again before applying it, so neither the
 * model nor a bug in the agent can make Lift apply anything else. Everything outside them is a
 * proposal: shown on the diagnosis card, never applied.
 */

/** The failures autofix looks at: the app's own. Lift's (a clone, a timeout, a lost image) aren't. */
export const AUTOFIX_ERROR_CODES = ["build_failed", "crashed", "healthcheck_failed"] as const;

/** Autofix makes at most this many fixes in a chain of failures; after them, a human decides. */
export const AUTOFIX_MAX_FIXES = 3;

/** Node and Python versions autofix may switch a build to (`RAILPACK_*_VERSION`). */
export const AUTOFIX_NODE_VERSIONS = ["20", "22", "24"] as const;
export const AUTOFIX_PYTHON_VERSIONS = ["3.11", "3.12", "3.13"] as const;
/** Memory autofix may raise a service to, at most (MiB). */
export const AUTOFIX_MAX_MEMORY_MB = 1024;

export const AUTOFIX_SETTINGS = [
  "port",
  "healthcheckPath",
  "memoryMb",
  "startCommand",
  "buildCommand",
  "rootDir",
] as const;
export type AutofixSetting = (typeof AUTOFIX_SETTINGS)[number];

/** One change: a service setting (its value as text, like "8080") or a variable. */
export const AutofixChange = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("setting"),
    setting: z.enum(AUTOFIX_SETTINGS),
    value: z.string().trim().min(1).max(1000),
  }),
  z.strictObject({
    kind: z.literal("variable"),
    key: VariableKey,
    value: z.string().min(1).max(VARIABLE_VALUE_MAX_LENGTH),
  }),
]);
export type AutofixChange = z.infer<typeof AutofixChange>;

/** What the rules look at: the service now, its variables, and the repo's example env file. */
export interface AutofixFacts {
  service: { port: number; healthcheckPath: string; memoryMb: number };
  variables: { key: string; source: StoredVariableSource }[];
  /** `KEY=value` pairs from `.env.example`, `.env.sample` or `.env.template` at the commit. */
  envExample: Record<string, string>;
}

export type AutofixVerdict = { ok: true } | { ok: false; reason: string };

const no = (reason: string): AutofixVerdict => ({ ok: false, reason });
const YES: AutofixVerdict = { ok: true };

/** Whether autofix may make this change by itself, and why not when it may not. */
export function allowedChange(change: AutofixChange, facts: AutofixFacts): AutofixVerdict {
  if (change.kind === "setting") {
    const { setting, value } = change;
    if (setting === "port") {
      const port = Number(value);
      if (!/^\d+$/.test(value) || port < 1024 || port > 65_535) {
        return no(`${value} isn't a port between 1024 and 65535`);
      }
      return port === facts.service.port ? no(`the port is already ${port}`) : YES;
    }
    if (setting === "healthcheckPath") {
      if (!HealthcheckPath.safeParse(value).success || value.length > 200 || value.includes("..")) {
        return no(`${value} isn't a health check path`);
      }
      return value === facts.service.healthcheckPath ? no("the path is already that") : YES;
    }
    if (setting === "memoryMb") {
      const memory = Number(value);
      if (!/^\d+$/.test(value) || memory > AUTOFIX_MAX_MEMORY_MB) {
        return no(`autofix raises memory to ${AUTOFIX_MAX_MEMORY_MB} MiB at most`);
      }
      return memory > facts.service.memoryMb ? YES : no("autofix only raises memory");
    }
    return no(`a change to the ${setting} is proposed, never applied by itself`);
  }

  const { key, value } = change;
  if (isReservedVariableKey(key)) return no(`Lift sets ${key} itself`);
  const existing = facts.variables.find((variable) => variable.key === key);
  if (existing && existing.source !== "agent") {
    return no(`${key} is set already, and autofix never overwrites it`);
  }
  if (key === "RAILPACK_NODE_VERSION") {
    return (AUTOFIX_NODE_VERSIONS as readonly string[]).includes(value)
      ? YES
      : no(`Node ${value} isn't one autofix switches to (${AUTOFIX_NODE_VERSIONS.join(", ")})`);
  }
  if (key === "RAILPACK_PYTHON_VERSION") {
    return (AUTOFIX_PYTHON_VERSIONS as readonly string[]).includes(value)
      ? YES
      : no(`Python ${value} isn't one autofix switches to`);
  }
  if (key.startsWith("NPM_CONFIG_")) {
    return value === "true" || value === "false" ? YES : no(`${key} may only be true or false`);
  }
  // Any other variable only as a safe default: the repo's own example value, and nothing secret.
  if (looksSecret(key, value)) return no(`${key} looks like a secret, so you provide it`);
  if (isPlaceholder(value)) return no(`${value} is a placeholder`);
  if (facts.envExample[key] !== value) {
    return no(`${key}=${value} isn't the repo's example value`);
  }
  return existing ? no(`${key} is set already`) : YES;
}

/**
 * `KEY=value` pairs from an example env file: comments, blank lines and `export ` are skipped,
 * and quotes around a value are removed. A key without a value maps to "".
 */
export function parseEnvExample(text: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (line === "" || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    if (!VariableKey.safeParse(key).success) continue;
    let value = line.slice(equals + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    pairs[key] = value;
  }
  return pairs;
}

/** The example env files autofix reads for safe defaults, in order. */
export const ENV_EXAMPLE_FILES = [".env.example", ".env.sample", ".env.template"] as const;

/** Where to look for them: the service's root directory first, then the repo's root. */
export function envExamplePaths(rootDir: string): string[] {
  const inRoot = ENV_EXAMPLE_FILES.map((file) => file as string);
  if (rootDir === "." || rootDir === "") return inRoot;
  return [...ENV_EXAMPLE_FILES.map((file) => `${rootDir.replace(/\/+$/, "")}/${file}`), ...inRoot];
}

const SETTING_NAMES: Record<AutofixSetting, string> = {
  port: "port",
  healthcheckPath: "health check path",
  memoryMb: "memory",
  startCommand: "start command",
  buildCommand: "build command",
  rootDir: "root directory",
};

/**
 * One line for the diagnosis card: "Set the port to 8080". A variable's value shows only when
 * Lift applied it, which the rules allow only for values that aren't secret.
 */
export function describeChange(change: AutofixChange, applied: boolean): string {
  if (change.kind === "setting") {
    const value = change.setting === "memoryMb" ? `${change.value} MiB` : change.value;
    return applied
      ? `Set the ${SETTING_NAMES[change.setting]} to ${value}`
      : `Change the ${SETTING_NAMES[change.setting]} to ${value}`;
  }
  return applied ? `Set ${change.key} to ${change.value}` : `Set ${change.key}`;
}
