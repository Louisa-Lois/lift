import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `check-env` runs in the deploy before the rollout (infra/docker/api-entrypoint.sh).
const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));

function checkEnv(env: Record<string, string>): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, ["--import", "tsx", entry, "check-env"], {
      env: { PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    const failed = error as { status: number; stdout: string; stderr: string };
    return { code: failed.status, output: `${failed.stdout}${failed.stderr}` };
  }
}

describe("check-env", () => {
  it("passes a valid environment and starts nothing", () => {
    const result = checkEnv({ NODE_ENV: "development" });
    expect(result).toEqual({ code: 0, output: "check-env: the API's environment is valid\n" });
  });

  it("fails naming the key, never echoing the value", () => {
    const result = checkEnv({ NODE_ENV: "development", WORKER_TOKEN: "too-short-secret-value" });
    expect(result.code).toBe(1);
    expect(result.output).toContain("WORKER_TOKEN");
    expect(result.output).not.toContain("too-short-secret-value");
  });
});
