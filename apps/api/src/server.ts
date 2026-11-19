import { API_BASE_PATH } from "@lift/shared";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Env } from "./env";
import { loggerOptions } from "./lib/logger";
import { registerDb } from "./plugins/db";
import { registerErrorHandling } from "./plugins/errors";
import { registerOpenApi } from "./plugins/openapi";
import { registerRedis } from "./plugins/redis";
import { healthRoutes } from "./routes/v1/health";

export interface ServerOptions {
  /** Where pino writes, instead of stdout; tests read the logs from it. */
  logStream?: { write(message: string): void };
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

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  registerDb(app, env.DATABASE_URL);
  registerRedis(app, env.REDIS_URL);
  registerOpenApi(app);

  app.register(healthRoutes, { prefix: API_BASE_PATH });

  return app;
}

export type App = ReturnType<typeof buildServer>;
