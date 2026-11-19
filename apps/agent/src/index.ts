import { Redis } from "ioredis";
import { redisBudget } from "./budget";
import { type Env, loadEnv } from "./env";
import { liftApiAs } from "./lift-api";
import { anthropicModel } from "./llm";
import { loadPrompts } from "./prompts";
import { buildServer } from "./server";

let env: Env;
let prompts: ReturnType<typeof loadPrompts>;
try {
  env = loadEnv();
  prompts = loadPrompts();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
const token = env.AGENT_SERVICE_TOKEN;
const app = buildServer(env, {
  prompts,
  budget: redisBudget(redis),
  model: env.ANTHROPIC_API_KEY ? anthropicModel(env.ANTHROPIC_API_KEY) : null,
  repoFor: token ? (userId) => liftApiAs({ apiUrl: env.API_URL, token, userId }).github : null,
});

let redisDown = false;
redis.on("error", (error) => {
  if (redisDown) return;
  redisDown = true;
  app.log.warn({ err: error }, "Redis is unreachable; retrying");
});
redis.on("ready", () => {
  if (!redisDown) return;
  redisDown = false;
  app.log.info("Redis is reachable again");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    redis.disconnect();
    process.exit(0);
  });
}

try {
  await app.listen({ host: env.HOST, port: env.AGENT_PORT });
  app.log.info(
    { prompts: Object.values(prompts).map((prompt) => `${prompt.name}@${prompt.hash}`) },
    env.ANTHROPIC_API_KEY ? "the assistant is ready" : "no ANTHROPIC_API_KEY: planning answers 503",
  );
} catch (error) {
  app.log.error(error, "agent service failed to start");
  process.exit(1);
}
