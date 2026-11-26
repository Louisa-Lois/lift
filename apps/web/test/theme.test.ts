// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Louisa replaces theme.css's values (docs/briefs/louisa-design.md); these tests make sure no
// variable the dashboard reads goes missing along the way.
const theme = readFileSync(new URL("../src/styles/theme.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");

const STATUSES = ["queued", "building", "deploying", "active", "failed", "canceled"];
const COLOURS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "border",
  "input",
  "ring",
  ...STATUSES.map((status) => `status-${status}`),
];

/** The custom properties declared inside the first block that starts with `selector {`. */
function declared(css: string, selector: string): Set<string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("}", start));
  return new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1] as string));
}

describe("theme.css", () => {
  it.each([":root", ".dark"])("%s defines every colour the dashboard uses", (selector) => {
    const names = declared(theme, selector);
    const missing = COLOURS.filter((name) => !names.has(`--${name}`));
    expect(missing).toEqual([]);
  });

  it("defines the fonts and the radius", () => {
    const root = declared(theme, ":root");
    for (const name of ["--font-sans", "--font-mono", "--radius"]) {
      expect(root.has(name), name).toBe(true);
    }
  });

  it("gives headings the display font", () => {
    expect(declared(theme, ":root").has("--font-display")).toBe(true);
    expect(globals).toContain("--font-heading: var(--font-display);");
  });

  it("is mapped to a Tailwind colour for every status", () => {
    for (const status of STATUSES) {
      expect(globals).toContain(`--color-status-${status}: var(--status-${status});`);
    }
  });
});
