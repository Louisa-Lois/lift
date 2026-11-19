import { type DeploymentLogStreamEvent, LiftApiError } from "@lift/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { useLogStream } from "@/lib/hooks/use-log-stream";

vi.mock("@/lib/api", () => ({ api: { deployments: { streamLogs: vi.fn() } } }));

const log = (id: string): DeploymentLogStreamEvent => ({
  id,
  event: "log",
  data: { ts: "2026-11-21T09:00:00.000Z", stream: "build", line: `line ${id}` },
});
const end = (status: "active" | "failed"): DeploymentLogStreamEvent => ({
  id: null,
  event: "end",
  data: { status },
});

type Step = DeploymentLogStreamEvent | Error | "hang";

/** Each call to streamLogs plays the next connection's steps: messages, then a drop or a hang. */
function script(...connections: Step[][]) {
  vi.mocked(api.deployments.streamLogs).mockImplementation(((
    _id: string,
    options?: { signal?: AbortSignal },
  ) =>
    (async function* () {
      for (const step of connections.shift() ?? []) {
        if (step === "hang") {
          await new Promise((resolve) => options?.signal?.addEventListener("abort", resolve));
          return;
        }
        if (step instanceof Error) throw step;
        yield step;
      }
    })()) as typeof api.deployments.streamLogs);
}

const ids = (lines: { id: string }[]) => lines.map((line) => line.id);
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.deployments.streamLogs).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLogStream", () => {
  it("replays, resumes after a drop without repeating a line, and stops at end", async () => {
    script(
      [log("1-0"), log("1-1"), new TypeError("network error")],
      [log("1-1"), log("1-2"), end("active")],
    );
    const { result } = renderHook(() => useLogStream("dep_x"));
    await advance(0);
    expect(result.current.state).toBe("reconnecting");
    expect(ids(result.current.lines)).toEqual(["1-0", "1-1"]);

    await advance(1_000);
    expect(api.deployments.streamLogs).toHaveBeenLastCalledWith(
      "dep_x",
      expect.objectContaining({ lastEventId: "1-1" }),
    );
    expect(result.current.state).toBe("ended");
    expect(result.current.endStatus).toBe("active");
    expect(ids(result.current.lines)).toEqual(["1-0", "1-1", "1-2"]);
  });

  it("shows lines while live, a hundred milliseconds at a time", async () => {
    script([log("1-0"), log("1-1"), "hang"]);
    const { result } = renderHook(() => useLogStream("dep_x"));
    await advance(0);
    expect(result.current.state).toBe("live");
    await advance(100);
    expect(ids(result.current.lines)).toEqual(["1-0", "1-1"]);
  });

  it("waits 1, 2, 5, then 10 seconds between attempts", async () => {
    const down = () => [new TypeError("down")];
    script(down(), down(), down(), down(), down(), [end("failed")]);
    renderHook(() => useLogStream("dep_x"));
    const calls = () => vi.mocked(api.deployments.streamLogs).mock.calls.length;
    await advance(0);
    expect(calls()).toBe(1);
    for (const [wait, expected] of [
      [1_000, 2],
      [2_000, 3],
      [5_000, 4],
      [10_000, 5],
      [10_000, 6],
    ] as const) {
      await advance(wait - 1);
      expect(calls()).toBe(expected - 1);
      await advance(1);
      expect(calls()).toBe(expected);
    }
  });

  it("gives up on a deployment that isn't there", async () => {
    script([
      new LiftApiError({
        type: "about:blank",
        title: "Not found",
        status: 404,
        detail: "No deployment",
        code: "not_found",
      }),
    ]);
    const { result } = renderHook(() => useLogStream("dep_x"));
    await advance(30_000);
    expect(result.current.state).toBe("ended");
    expect(api.deployments.streamLogs).toHaveBeenCalledTimes(1);
  });
});
