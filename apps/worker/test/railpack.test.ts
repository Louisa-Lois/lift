import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  commandVariables,
  railpackArgs,
  railpackBuild,
  splitBuildVariables,
} from "../src/build/railpack";

describe("Railpack's arguments", () => {
  it("name each variable and never hold its value", () => {
    expect(railpackArgs("/builds/dep", "lift/svc:dep", ["API_SECRET", "NEXT_PUBLIC_X"])).toEqual([
      "build",
      "/builds/dep",
      "--name",
      "lift/svc:dep",
      "--progress",
      "plain",
      "--env",
      "API_SECRET",
      "--env",
      "NEXT_PUBLIC_X",
    ]);
  });

  it("leave out the variables the build tools read themselves", () => {
    expect(
      splitBuildVariables({
        PATH: "/evil/bin",
        HOME: "/tmp",
        DOCKER_HOST: "tcp://evil:2375",
        BUILDKIT_HOST: "tcp://evil:1234",
        HTTPS_PROXY: "http://proxy",
        LD_PRELOAD: "/evil.so",
        NEXT_PUBLIC_X: "shown",
        RAILPACK_START_CMD: "node server.js",
      }),
    ).toEqual({
      passed: { NEXT_PUBLIC_X: "shown", RAILPACK_START_CMD: "node server.js" },
      skipped: ["BUILDKIT_HOST", "DOCKER_HOST", "HOME", "HTTPS_PROXY", "LD_PRELOAD", "PATH"],
    });
  });
});

describe("a service's commands", () => {
  it("become the settings Railpack reads, only when they're set", () => {
    expect(commandVariables({ buildCommand: "npm run build:prod", startCommand: null })).toEqual({
      RAILPACK_BUILD_CMD: "npm run build:prod",
    });
    expect(commandVariables({ buildCommand: null, startCommand: "node server.js" })).toEqual({
      RAILPACK_START_CMD: "node server.js",
    });
    expect(commandVariables({ buildCommand: null, startCommand: null })).toEqual({});
  });
});

describe("a Railpack build", () => {
  let bin: string;
  let savedPath: string | undefined;

  beforeAll(async () => {
    // A stand-in railpack that prints what it was given.
    bin = await mkdtemp(path.join(tmpdir(), "lift-fake-railpack-"));
    await writeFile(
      path.join(bin, "railpack"),
      '#!/bin/sh\necho "argv: $*"\necho "env: $API_SECRET"\necho "path: $(command -v railpack)"\n',
    );
    await chmod(path.join(bin, "railpack"), 0o755);
    savedPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ""}`;
  });
  afterAll(async () => {
    process.env.PATH = savedPath;
    await rm(bin, { recursive: true, force: true });
  });

  it("hands values over in Railpack's environment, so argv never holds one", async () => {
    const lines: string[] = [];
    const result = await railpackBuild({
      dir: "/builds/dep",
      imageTag: "lift/svc:dep",
      buildVariables: { API_SECRET: "s3cr3t-value-1234", PATH: "/evil/bin" },
      buildkitHost: "tcp://buildkit:1234",
      timeoutMs: 10_000,
      onLine: (line) => lines.push(line),
    });
    expect(result.code).toBe(0);
    expect(lines).toEqual([
      "argv: build /builds/dep --name lift/svc:dep --progress plain --env API_SECRET",
      "env: s3cr3t-value-1234",
      // The service's PATH didn't replace the worker's.
      `path: ${path.join(bin, "railpack")}`,
    ]);
  });
});
