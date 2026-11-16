import { QUEUE_NAMES } from "@lift/shared";
import { type Env, loadEnv } from "./env";

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// The worker agent (docs/prd/04-infrastructure.md). INF-04 consumes the build queue, INF-05 the
// deploy queue, INF-10 the ops queue; INF-09 ships logs and metrics; INF-12 reconciles.
console.log(
  `worker started (${env.NODE_ENV}); queues to consume: ${Object.values(QUEUE_NAMES)
    .filter((name) => name !== QUEUE_NAMES.agent)
    .join(", ")}`,
);

// Stay up like the real worker will, and stop cleanly when asked.
const heartbeat = setInterval(() => {}, 60_000);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(heartbeat);
    console.log(`worker stopping (${signal})`);
    process.exit(0);
  });
}
