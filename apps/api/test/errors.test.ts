import { API_BASE_PATH, CreateServiceBody, PROBLEM_CONTENT_TYPE, Problem } from "@lift/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { problem } from "../src/lib/problem";
import { buildServer } from "../src/server";
import { testEnv } from "./helpers/env";

const app = buildServer(testEnv());

beforeAll(async () => {
  // Routes that exist only in this test, to drive each kind of error. They're public, so the
  // route guard (plugins/scopes.ts) lets them through without a session.
  app.post(
    `${API_BASE_PATH}/test/services`,
    { config: { public: true }, schema: { body: CreateServiceBody } },
    async () => ({ ok: true }),
  );
  app.get(`${API_BASE_PATH}/test/conflict`, { config: { public: true } }, async () => {
    throw problem("conflict", "The deployment was canceled.");
  });
  app.get(`${API_BASE_PATH}/test/crash`, { config: { public: true } }, async () => {
    throw new Error("database password is hunter2");
  });
  await app.ready();
});
afterAll(() => app.close());

function expectProblem(response: Awaited<ReturnType<typeof app.inject>>, status: number) {
  expect(response.statusCode).toBe(status);
  expect(response.headers["content-type"]).toContain(PROBLEM_CONTENT_TYPE);
  return Problem.parse(response.json());
}

describe("problem+json errors", () => {
  it("answers an unknown route with not_found", async () => {
    const response = await app.inject({ method: "GET", url: `${API_BASE_PATH}/nope?token=x` });
    const body = expectProblem(response, 404);
    expect(body.code).toBe("not_found");
    expect(body.detail).not.toContain("token");
  });

  it("maps a schema failure to validation_failed with dot-path fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: `${API_BASE_PATH}/test/services`,
      payload: {
        name: "web",
        repo: { owner: "-not a login-", name: "next-hello" },
        branch: "main",
      },
    });
    const body = expectProblem(response, 400);
    expect(body.code).toBe("validation_failed");
    expect(Object.keys(body.fields ?? {})).toContain("repo.owner");
  });

  it("refuses unknown fields in a strict body", async () => {
    const response = await app.inject({
      method: "POST",
      url: `${API_BASE_PATH}/test/services`,
      payload: {
        name: "web",
        repo: { owner: "lift-demo", name: "next-hello" },
        branch: "main",
        x: 1,
      },
    });
    expect(expectProblem(response, 400).code).toBe("validation_failed");
  });

  it("sends a thrown problem with its own status and code", async () => {
    const response = await app.inject({ method: "GET", url: `${API_BASE_PATH}/test/conflict` });
    const body = expectProblem(response, 409);
    expect(body).toMatchObject({ code: "conflict", detail: "The deployment was canceled." });
  });

  it("hides an unexpected error's message and stack behind internal", async () => {
    const response = await app.inject({ method: "GET", url: `${API_BASE_PATH}/test/crash` });
    const body = expectProblem(response, 500);
    expect(body.code).toBe("internal");
    expect(response.body).not.toContain("hunter2");
    expect(response.body).not.toContain("at ");
  });

  it("answers malformed JSON as the client's error", async () => {
    const response = await app.inject({
      method: "POST",
      url: `${API_BASE_PATH}/test/services`,
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(expectProblem(response, 400).code).toBe("validation_failed");
  });
});

describe("logging problems", () => {
  it("logs what a 5xx problem told the person, never its cause, and leaves 4xx ones out", async () => {
    const lines: string[] = [];
    const logged = buildServer(testEnv({ LOG_LEVEL: "warn" }), {
      logStream: { write: (line) => void lines.push(line) },
    });
    const detail = "GitHub answered 403 to GET /repos/lift-demo/next-hello/commits/main.";
    logged.get(`${API_BASE_PATH}/test/github`, { config: { public: true } }, async () => {
      throw problem("github_error", detail, { cause: new Error("GitHub said gho_cause_token") });
    });
    logged.get(`${API_BASE_PATH}/test/conflict`, { config: { public: true } }, async () => {
      throw problem("conflict", "The deployment was canceled.");
    });
    try {
      expect((await logged.inject({ url: `${API_BASE_PATH}/test/github` })).statusCode).toBe(502);
      expect((await logged.inject({ url: `${API_BASE_PATH}/test/conflict` })).statusCode).toBe(409);
    } finally {
      await logged.close();
    }
    const problems = lines
      .map((line) => JSON.parse(line) as { level: number; msg: string; problem?: unknown })
      .filter((entry) => entry.msg === "answered with a problem");
    expect(problems).toEqual([
      expect.objectContaining({
        level: 40,
        problem: { code: "github_error", status: 502, detail },
      }),
    ]);
    expect(lines.join("")).not.toContain("gho_cause_token");
  });
});
