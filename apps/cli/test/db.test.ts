import fs from "node:fs";
import path from "node:path";
import * as fx from "@lift/shared/fixtures";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/program";
import { cleanDir, createTempDir } from "./helpers";

describe("lift db", () => {
  it("lists databases in the project", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          token: "lift_pat_test",
          user: fx.me,
          apiUrl: "http://localhost:3000",
        }),
      );

      const { exitCode, stdout, stderr } = await runCli(["db", "list"], {
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toMatch(/NAME/i);
      expect(stdout).toMatch(/TYPE/i);
      expect(stdout).toContain(fx.database.name);
    } finally {
      cleanDir(configDir);
    }
  });

  it("provisions postgres database with lift db add postgres", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          token: "lift_pat_test",
          user: fx.me,
          apiUrl: "http://localhost:3000",
        }),
      );

      const { exitCode, stdout } = await runCli(["db", "add", "postgres"], {
        configDir,
      });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/added postgres database/i);
      expect(stdout).toContain(fx.database.name);
    } finally {
      cleanDir(configDir);
    }
  });

  it("fails with exit code 2 on unsupported database type", async () => {
    const configDir = createTempDir();
    try {
      const configFile = path.join(configDir, "config.json");
      fs.writeFileSync(
        configFile,
        JSON.stringify({
          token: "lift_pat_test",
          user: fx.me,
          apiUrl: "http://localhost:3000",
        }),
      );

      const { exitCode, stderr } = await runCli(["db", "add", "mongo"], {
        configDir,
      });

      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/unsupported database type/i);
    } finally {
      cleanDir(configDir);
    }
  });
});
