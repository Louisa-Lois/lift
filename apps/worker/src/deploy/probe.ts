import type { Docker } from "../docker";

export interface ProbeResult {
  healthy: boolean;
  status: number | null;
  ms: number | null;
  /** Why it isn't healthy, worded for the log: "connection refused", "answered 502"… */
  reason: string;
}

/** curl's exit codes when no HTTP answer came back. */
const CURL_REASONS: Record<number, string> = {
  6: "the name didn't resolve",
  7: "connection refused",
  28: "no answer within 2s",
  52: "an empty reply",
  56: "the connection was reset",
};

/**
 * Reads curl's `-w '%{http_code} %{time_total}'`. Any answer below 500 counts as healthy (a 404
 * still means the app listens); no answer, or a 5xx, doesn't.
 */
export function readProbe(exitCode: number | null, stdout: string): ProbeResult {
  const [code = "0", seconds = "0"] = stdout.trim().split(/\s+/);
  const status = Number(code);
  if (!Number.isInteger(status) || status < 100) {
    const reason = CURL_REASONS[exitCode ?? -1] ?? `no answer (curl exited with ${exitCode})`;
    return { healthy: false, status: null, ms: null, reason };
  }
  const ms = Math.round(Number(seconds) * 1000);
  return { healthy: status < 500, status, ms, reason: `answered ${status}` };
}

/**
 * Asks the app for its health-check path from inside lift-edge, through the probe container: the
 * worker itself stays off the apps' network (and on a Mac can't reach container IPs at all).
 */
export async function probe(
  docker: Docker,
  probeContainer: string,
  url: string,
): Promise<ProbeResult> {
  const { exitCode, stdout } = await docker.exec(
    probeContainer,
    ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code} %{time_total}", "--max-time", "2", url],
    10_000,
  );
  return readProbe(exitCode, stdout);
}
