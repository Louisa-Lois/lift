import { childEnv, run } from "./process";

/** The tools the build job runs, and how to ask each for its version. */
const TOOLS: [name: string, args: string[]][] = [
  ["git", ["--version"]],
  ["railpack", ["--version"]],
  // Railpack runs `docker load`; without the CLI it hangs instead of failing (spike S1).
  ["docker", ["version", "--format", "{{.Client.Version}}"]],
];

/** Checks the build tools are installed; returns the ones that aren't. */
export async function missingTools(): Promise<string[]> {
  const missing: string[] = [];
  for (const [name, args] of TOOLS) {
    try {
      const result = await run(name, args, { env: childEnv(), timeoutMs: 10_000 });
      if (result.code !== 0) missing.push(name);
    } catch {
      missing.push(name);
    }
  }
  return missing;
}
