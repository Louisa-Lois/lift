import { Redis } from "ioredis";
import { runAutofix } from "./autofix/autofix";
import { startAutofixConsumer } from "./autofix/consumer";
import { redisBudget } from "./budget";
import { type Env, loadEnv } from "./env";
import { autofixApi } from "./internal-api";
import { liftApiAs } from "./lift-api";
import { anthropicModel, createLlm } from "./llm";
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
const budget = redisBudget(redis);
const model = env.ANTHROPIC_API_KEY ? anthropicModel(env.ANTHROPIC_API_KEY) : null;
const app = buildServer(env, {
  prompts,
  budget,
  model,
  repoFor: token ? (userId) => liftApiAs({ apiUrl: env.API_URL, token, userId }).github : null,
});

// Autofix (AI-06) runs from the `lift-agent` queue once the model and the API's token are set.
const autofix =
  model && token
    ? startAutofixConsumer({
        redisUrl: env.REDIS_URL,
        log: app.log,
        run: (deploymentId) =>
          runAutofix(
            {
              llm: createLlm({
                model,
                budget,
                dailyBudget: env.AGENT_DAILY_TOKEN_BUDGET,
                log: app.log,
              }),
              prompts,
              internal: autofixApi({ apiUrl: env.API_URL, token }),
              apiAs: (userId) => liftApiAs({ apiUrl: env.API_URL, token, userId }),
              log: app.log,
            },
            deploymentId,
          ),
      })
    : null;

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
    await autofix?.close();
    await app.close();
    redis.disconnect();
    process.exit(0);
  });
}

try {
  await app.listen({ host: env.HOST, port: env.AGENT_PORT });
  app.log.info(
    { prompts: Object.values(prompts).map((prompt) => `${prompt.name}@${prompt.hash}`) },
    autofix
      ? "the assistant is ready: plans, and autofix from the lift-agent queue"
      : "no ANTHROPIC_API_KEY or AGENT_SERVICE_TOKEN: planning answers 503, autofix is off",
  );
} catch (error) {
  app.log.error(error, "agent service failed to start");
  process.exit(1);
}
