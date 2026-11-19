import { API_BASE_PATH } from "@lift/shared";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Env } from "./env";
import { loggerOptions } from "./lib/logger";
import { authPlugin } from "./plugins/auth";
import { registerDb } from "./plugins/db";
import { registerErrorHandling } from "./plugins/errors";
import { registerOpenApi } from "./plugins/openapi";
import { registerQueues } from "./plugins/queues";
import { registerRedis } from "./plugins/redis";
import { authRoutes } from "./routes/v1/auth";
import { githubRoutes } from "./routes/v1/github";
import { healthRoutes } from "./routes/v1/health";
import { meRoutes } from "./routes/v1/me";
import { projectRoutes } from "./routes/v1/projects";
import { serviceRoutes } from "./routes/v1/services";
import { createSecretBox } from "./services/crypto";
import { createGithub } from "./services/github";

export interface ServerOptions {
  /** Where pino writes, instead of stdout; tests read the logs from it. */
  logStream?: { write(message: string): void };
  /** The fetch GitHub calls go through; tests answer them from recorded responses. */
  githubFetch?: typeof globalThis.fetch;
  /** BullMQ key prefix; tests use their own so they never see each other's jobs. */
  queuePrefix?: string;
}

/**
 * Builds the API without starting it, so tests can call it with `app.inject()`. Request and
 * response schemas are Zod schemas from packages/shared, which validate input, check output
 * and generate /api/v1/openapi.json. Each resource gets one file in routes/v1.
 */
export function buildServer(env: Env, options: ServerOptions = {}) {
  const app = Fastify({
    logger: loggerOptions(env.LOG_LEVEL, options.logStream),
  }).withTypeProvider<ZodTypeProvider>();

  const github = createGithub({
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    fetch: options.githubFetch,
  });
  const secretBox = env.ENCRYPTION_KEY ? createSecretBox(env.ENCRYPTION_KEY) : null;

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  registerDb(app, env.DATABASE_URL);
  registerRedis(app, env.REDIS_URL);
  registerQueues(app, env.REDIS_URL, options.queuePrefix);
  registerOpenApi(app);
  app.register(authPlugin, { env });

  app.register(healthRoutes, { prefix: API_BASE_PATH });
  app.register(authRoutes, { prefix: API_BASE_PATH, env, github, secretBox });
  app.register(meRoutes, { prefix: API_BASE_PATH });
  app.register(githubRoutes, { prefix: API_BASE_PATH, github, secretBox });
  app.register(projectRoutes, {
    prefix: API_BASE_PATH,
    appsDomain: env.APPS_DOMAIN,
    github,
    secretBox,
  });
  app.register(serviceRoutes, { prefix: API_BASE_PATH, appsDomain: env.APPS_DOMAIN });

  return app;
}

export type App = ReturnType<typeof buildServer>;
