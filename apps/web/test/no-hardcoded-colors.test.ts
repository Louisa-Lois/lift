// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Components take colours only from theme.css (docs/prd/02-frontend.md, "Tokens"), so Louisa's
// theme restyles every screen. shadcn/ui primitives and Louisa's own pages are hers to style.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const SKIP = [path.join("components", "ui"), path.join("app", "(marketing)"), "mocks"];

const PALETTE =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|decoration|caret|accent|shadow|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d{2,3})?\b/;
const HEX = /(?<![\w&/])#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (SKIP.some((skip) => path.relative(SRC, full) === skip)) return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(name) && !full.includes(`${path.sep}styles${path.sep}`)
      ? [full]
      : [];
  });
}

describe("colours", () => {
  it("come from the theme, never from palette classes or hex values", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          PALETTE.test(line) || HEX.test(line)
            ? [`${path.relative(SRC, file)}:${index + 1}: ${line.trim()}`]
            : [],
        ),
    );
    expect(offenders).toEqual([]);
  });
});
