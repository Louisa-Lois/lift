// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Louisa's brand files live in public/brand (UI-01). The root layout declares her favicon, and
// nothing may point at a brand file that isn't there: a typo would only show as a broken image.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const PUBLIC = fileURLToPath(new URL("../public", import.meta.url));

/** Every source file under src, as [path relative to src, contents]. */
function sources(dir: string = SRC): [string, string][] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(tsx?|css)$/.test(name)
      ? [[path.relative(SRC, full), readFileSync(full, "utf8")] as [string, string]]
      : [];
  });
}

describe("brand files", () => {
  it("include the favicon and the Apple touch icon, declared in the root layout", () => {
    const layout = readFileSync(path.join(SRC, "app", "layout.tsx"), "utf8");
    expect(layout).toContain('"/brand/favicon.svg"');
    expect(layout).toContain('"/brand/favicon-180.png"');
  });

  it("exist for every /brand path the app points at", () => {
    const missing = sources().flatMap(([file, text]) =>
      [...text.matchAll(/["'(]\/brand\/([\w./-]+)["')]/g)]
        .map((match) => `/brand/${match[1]}`)
        .filter((url) => !existsSync(path.join(PUBLIC, url)))
        .map((url) => `${file}: ${url}`),
    );
    expect(missing).toEqual([]);
  });
});
