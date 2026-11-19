import { INTERNAL_BASE_PATH } from "@lift/shared";
import { describe, expect, it } from "vitest";
import { createInternalApi, StopDeployment } from "../src/internal-api";

const DEPLOYMENT = "dep_aaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN = "t".repeat(40);
const AT = "2026-11-21T09:00:00.000Z";

/** A fetch that answers from a script, one response per call, and records each request. */
function scripted(...answers: (Response | Error)[]) {
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    requests.push(new Request(input, init));
    const answer = answers.shift();
    if (!answer) throw new Error("no more answers");
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, requests };
}

const api = (fetch: typeof globalThis.fetch) =>
  createInternalApi({
    baseUrl: "http://10.0.0.5:4000",
    token: TOKEN,
    fetch,
    retryDelaysMs: [0, 0],
  });

describe("the internal API client", () => {
  it("sends the worker token and checks the answer against the contract", async () => {
    const { fetch, requests } = scripted(Response.json({ status: "building" }));
    expect(await api(fetch).reportStatus(DEPLOYMENT, { status: "building", at: AT })).toEqual({
      status: "building",
    });
    const [request] = requests;
    expect(request?.url).toBe(
      `http://10.0.0.5:4000${INTERNAL_BASE_PATH}/deployments/${DEPLOYMENT}/status`,
    );
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(await request?.json()).toEqual({ status: "building", at: AT });
  });

  it("turns a 409 into StopDeployment: the deployment moved on", async () => {
    const { fetch } = scripted(
      Response.json({ code: "conflict", detail: "It is canceled" }, { status: 409 }),
    );
    await expect(
      api(fetch).reportStatus(DEPLOYMENT, { status: "building", at: AT }),
    ).rejects.toThrow(StopDeployment);
  });

  it("retries a 5xx or a network error, then gives up", async () => {
    const retried = scripted(
      new Response("down", { status: 503 }),
      new TypeError("fetch failed"),
      Response.json({ status: "building" }),
    );
    await expect(
      api(retried.fetch).reportStatus(DEPLOYMENT, { status: "building", at: AT }),
    ).resolves.toEqual({ status: "building" });
    expect(retried.requests).toHaveLength(3);

    const down = scripted(new TypeError("a"), new TypeError("b"), new TypeError("c"));
    await expect(
      api(down.fetch).reportStatus(DEPLOYMENT, { status: "building", at: AT }),
    ).rejects.toThrow("the API didn't answer");
  });

  it("doesn't retry a 401, and never sends a report the contract refuses", async () => {
    const refused = scripted(Response.json({ detail: "Send Authorization" }, { status: 401 }));
    await expect(api(refused.fetch).buildContext(DEPLOYMENT)).rejects.toThrow(/401/);
    expect(refused.requests).toHaveLength(1);

    const never = scripted();
    await expect(
      // @ts-expect-error: deploying needs an imageTag
      api(never.fetch).reportStatus(DEPLOYMENT, { status: "deploying", at: AT }),
    ).rejects.toThrow();
    expect(never.requests).toHaveLength(0);
  });
});
