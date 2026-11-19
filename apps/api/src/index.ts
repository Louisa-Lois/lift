import { type Env, loadEnv } from "./env";
import { buildServer } from "./server";

// `node dist/index.js check-env` validates the environment and exits. The deploy runs it before
// the rollout (infra/docker/api-entrypoint.sh), so a bad /opt/lift/.env stops the deploy while
// the previous release keeps serving. The messages name keys and rules, never values.
const checkOnly = process.argv[2] === "check-env";

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
if (checkOnly) {
  console.log("check-env: the API's environment is valid");
  process.exit(0);
}

const app = buildServer(env);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ host: env.HOST, port: env.API_PORT });
} catch (error) {
  app.log.error(error, "API failed to start");
  process.exit(1);
}
