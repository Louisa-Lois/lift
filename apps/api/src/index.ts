import { type Env, loadEnv } from "./env";
import { buildServer } from "./server";

let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
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
