import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./mocks/server";

export function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lift-cli-test-"));
}

export function cleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

beforeAll(() => {
  server.listen();
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
