import { isReservedVariableKey, VARIABLE_KEY_PATTERN } from "@lift/shared";

export interface ParsedDotenv {
  /** Each key's value; a later line wins over an earlier one with the same key. */
  values: Record<string, string>;
  /** Lines that couldn't be read, numbered from 1, with why. */
  errors: { line: number; message: string }[];
}

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };

/**
 * Reads `.env` text the way most dotenv tools do: `KEY=value` lines, an optional `export `, `#`
 * comments, and values that are bare, 'single-quoted' (taken as is) or "double-quoted" (with \n,
 * \t, \" and \\ escapes). A key must look like DATABASE_URL, and PORT and LIFT_* are Lift's.
 */
export function parseDotenv(text: string): ParsedDotenv {
  const values: Record<string, string> = {};
  const errors: ParsedDotenv["errors"] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const body = trimmed.replace(/^export\s+/, "");
    const equals = body.indexOf("=");
    if (equals < 1) {
      errors.push({ line, message: "Expected KEY=value" });
      return;
    }
    const key = body.slice(0, equals).trim();
    if (!VARIABLE_KEY_PATTERN.test(key) || key.length > 255) {
      errors.push({
        line,
        message: `${key} isn't a valid key: use A-Z, 0-9 and _, like DATABASE_URL`,
      });
      return;
    }
    if (isReservedVariableKey(key)) {
      errors.push({ line, message: `${key} is set by Lift` });
      return;
    }
    const value = readValue(body.slice(equals + 1).trim());
    if (value === null) {
      errors.push({ line, message: "This value's quote isn't closed" });
      return;
    }
    values[key] = value;
  });
  return { values, errors };
}

/** A value after `=`: quoted, or bare up to a ` #` comment. Null when a quote isn't closed. */
function readValue(raw: string): string | null {
  const quote = raw[0];
  if (quote === "'") {
    const end = raw.indexOf("'", 1);
    return end === -1 ? null : raw.slice(1, end);
  }
  if (quote === '"') {
    let value = "";
    for (let i = 1; i < raw.length; i++) {
      const char = raw.charAt(i);
      if (char === '"') return value;
      if (char === "\\" && i + 1 < raw.length) {
        const next = raw.charAt(i + 1);
        value += ESCAPES[next] ?? `\\${next}`;
        i++;
      } else {
        value += char;
      }
    }
    return null;
  }
  return raw.replace(/\s+#.*$/, "").trim();
}

/** Writes variables as `.env` text, sorted by key, quoting values only where they need it. */
export function printDotenv(values: Record<string, string>): string {
  return Object.keys(values)
    .sort()
    .map((key) => `${key}=${quoteValue(values[key] ?? "")}`)
    .join("\n");
}

function quoteValue(value: string): string {
  if (/^[^\s"'#\\]+$/.test(value)) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

export interface VariableDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

/** What turning `current` into `next` changes, each list sorted by key. */
export function diffVariables(
  current: Record<string, string>,
  next: Record<string, string>,
): VariableDiff {
  const added = Object.keys(next).filter((key) => !(key in current));
  const changed = Object.keys(next).filter((key) => key in current && current[key] !== next[key]);
  const removed = Object.keys(current).filter((key) => !(key in next));
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

/** The `PUT /services/:id/variables` body for a diff: values to set, and null to delete. */
export function changesFor(
  diff: VariableDiff,
  next: Record<string, string>,
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  for (const key of [...diff.added, ...diff.changed]) changes[key] = next[key] ?? "";
  for (const key of diff.removed) changes[key] = null;
  return changes;
}
