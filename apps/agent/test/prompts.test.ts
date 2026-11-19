import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadPrompts, PROMPT_NAMES } from "../src/prompts";

// Prompts are Lyse's to rewrite (AI-14): these tests check that each one loads, never its words.
describe("the prompts", () => {
  it("each load, aren't empty, and get a short hash for the logs", () => {
    const prompts = loadPrompts();
    for (const name of PROMPT_NAMES) {
      expect(prompts[name].text.length, name).toBeGreaterThan(0);
      expect(prompts[name].hash, name).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  const dirs: string[] = [];
  afterAll(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  it("stop the service from starting when one is missing or empty", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lift-prompts-"));
    dirs.push(dir);
    const url = pathToFileURL(`${dir}/`);
    expect(() => loadPrompts(url)).toThrow();
    for (const name of PROMPT_NAMES) await writeFile(path.join(dir, `${name}.md`), "  \n");
    expect(() => loadPrompts(url)).toThrow(/empty/);
  });
});
