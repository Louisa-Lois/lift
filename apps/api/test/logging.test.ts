import { API_BASE_PATH } from "@lift/shared";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server";
import { testEnv } from "./helpers/env";

describe("request logging", () => {
  it("never writes credentials or query strings", async () => {
    const lines: string[] = [];
    const app = buildServer(testEnv({ LOG_LEVEL: "info" }), {
      logStream: { write: (line) => void lines.push(line) },
    });
    try {
      await app.inject({
        method: "GET",
        url: `${API_BASE_PATH}/health?code=oauth-code-123&state=oauth-state-456`,
        headers: {
          authorization: "Bearer lift_pat_secret_value",
          cookie: "lift_session=session-cookie-value",
        },
      });
    } finally {
      await app.close();
    }
    const log = lines.join("");
    expect(log).toContain(`"url":"${API_BASE_PATH}/health"`);
    for (const secret of [
      "oauth-code-123",
      "oauth-state-456",
      "lift_pat_secret_value",
      "session-cookie-value",
    ]) {
      expect(log).not.toContain(secret);
    }
  });
});
