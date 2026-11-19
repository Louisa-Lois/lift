import { pino } from "pino";

/**
 * The worker's own log (stdout, JSON), read with `lift-release.sh compose logs worker`. Users'
 * build output goes to the deployment's log stream instead (log-sink.ts), never here.
 */
export function createLogger(level: string) {
  return pino({ level, base: { app: "worker" } });
}

export type Logger = ReturnType<typeof createLogger>;
