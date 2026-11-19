import { describe, expect, it } from "vitest";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";

describe("exit codes and global error handling", () => {
  it("exits with code 2 on unknown command and suggests help", async () => {
    const configDir = createTempDir();
    try {
      const { exitCode, stderr } = await runCli(["unknown-command"], { configDir });
      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/unknown command/i);
      expect(stderr).toContain("lift --help");
    } finally {
      cleanDir(configDir);
    }
  });

  it("exits with code 2 on invalid option flag", async () => {
    const configDir = createTempDir();
    try {
      const { exitCode, stderr } = await runCli(["--invalid-flag"], { configDir });
      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/unknown option/i);
      expect(stderr).toContain("lift --help");
    } finally {
      cleanDir(configDir);
    }
  });

  it("exits with code 0 on --version and --help", async () => {
    const configDir = createTempDir();
    try {
      const resVersion = await runCli(["--version"], { configDir });
      expect(resVersion.exitCode).toBe(0);

      const resHelp = await runCli(["--help"], { configDir });
      expect(resHelp.exitCode).toBe(0);
      expect(resHelp.stdout).toMatch(/Usage: lift/i);
    } finally {
      cleanDir(configDir);
    }
  });
});
