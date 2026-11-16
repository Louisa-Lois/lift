import { type Env, loadEnv } from "./env";
import { createCollabServer } from "./server";

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// Hocuspocus stops itself cleanly on SIGINT and SIGTERM (stopOnSignals defaults to true).
const server = createCollabServer(env);
await server.listen();
console.log(`collab server listening on ${server.webSocketURL}`);
