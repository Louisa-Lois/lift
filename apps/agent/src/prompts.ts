import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * The system prompts: plain Markdown in src/prompts/, written by Lyse (AI-14). They explain the
 * job to the model; every rule that must hold is checked in code after it answers, so a prompt
 * can change without weakening one. The build copies the folder next to the bundle.
 */
export const PROMPT_NAMES = ["planner"] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

export interface Prompt {
  name: PromptName;
  text: string;
  /** The first 12 hex characters of its SHA-256, logged with each model call. */
  hash: string;
}
export type Prompts = Record<PromptName, Prompt>;

/** Reads every prompt once; a missing or empty file stops the service from starting. */
export function loadPrompts(dir: URL = new URL("./prompts/", import.meta.url)): Prompts {
  const prompts = {} as Prompts;
  for (const name of PROMPT_NAMES) {
    const text = readFileSync(new URL(`${name}.md`, dir), "utf8").trim();
    if (text === "") throw new Error(`The prompt ${name}.md is empty`);
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
    prompts[name] = { name, text, hash };
  }
  return prompts;
}
