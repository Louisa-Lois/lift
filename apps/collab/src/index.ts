import { createDb } from "@lift/db";
import { type Env, loadEnv } from "./env";
import { createCollabServer } from "./server";

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { db, close } = createDb(env.DATABASE_URL);
// Hocuspocus stops itself on SIGINT and SIGTERM (stopOnSignals defaults to true): it saves every
// open document, then runs onDestroy, which closes the database pool.
const server = createCollabServer(env, db, { onDestroy: close });
await server.listen();
console.log(
  `collab server listening on ${server.webSocketURL}${env.COLLAB_SECRET ? "" : " (no COLLAB_SECRET, so every connection is refused)"}`,
);
