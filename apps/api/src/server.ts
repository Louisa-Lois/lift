import { API_BASE_PATH, INTERNAL_BASE_PATH, SSE_HEARTBEAT_MS } from "@lift/shared";
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
import { routeGuard } from "./plugins/scopes";
import { internalAgentRoutes } from "./routes/internal/agent";
import { internalDatabaseRoutes } from "./routes/internal/databases";
import { internalDeploymentRoutes } from "./routes/internal/deployments";
import { authRoutes } from "./routes/v1/auth";
import { cliLoginRoutes } from "./routes/v1/cli-logins";
import { cspReportRoutes } from "./routes/v1/csp-reports";
import { databaseRoutes } from "./routes/v1/databases";
import { deploymentRoutes } from "./routes/v1/deployments";
import { editorRoutes } from "./routes/v1/editor";
import { eventRoutes } from "./routes/v1/events";
import { githubRoutes } from "./routes/v1/github";
import { healthRoutes } from "./routes/v1/health";
import { logRoutes } from "./routes/v1/logs";
import { meRoutes } from "./routes/v1/me";
import { memberRoutes } from "./routes/v1/members";
import { planRoutes } from "./routes/v1/plans";
import { projectRoutes } from "./routes/v1/projects";
import { serviceRoutes } from "./routes/v1/services";
import { tokenRoutes } from "./routes/v1/tokens";
import { variableRoutes } from "./routes/v1/variables";
import { webhookRoutes } from "./routes/v1/webhooks";
import { createAgentClient } from "./services/agent-client";
import { createCollabClient } from "./services/collab-client";
import { createSecretBox } from "./services/crypto";
import { createGithub } from "./services/github";

export interface ServerOptions {
  /** Where pino writes, instead of stdout; tests read the logs from it. */
  logStream?: { write(message: string): void };
  /** The fetch GitHub calls go through; tests answer them from recorded responses. */
  githubFetch?: typeof globalThis.fetch;
  /** The fetch the agent service's calls go through; tests answer like the agent. */
  agentFetch?: typeof globalThis.fetch;
  /** The fetch the collab server's internal calls go through; tests answer like collab. */
  collabFetch?: typeof globalThis.fetch;
  /** BullMQ key prefix; tests use their own so they never see each other's jobs. */
  queuePrefix?: string;
  /** How long an event stream may stay quiet before a heartbeat; tests shorten it. */
  sseHeartbeatMs?: number;
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
  const agent = createAgentClient({
    url: env.AGENT_URL,
    token: env.AGENT_SERVICE_TOKEN,
    fetch: options.agentFetch,
  });
  const collab = createCollabClient({
    url: env.COLLAB_URL,
    secret: env.COLLAB_SECRET,
    fetch: options.collabFetch,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  registerDb(app, env.DATABASE_URL);
  registerRedis(app, env.REDIS_URL);
  registerQueues(app, env.REDIS_URL, options.queuePrefix);
  registerOpenApi(app);
  app.register(authPlugin, { env });
  // Every /api/v1 route needs a session or a token unless it is marked public.
  app.register(routeGuard);

  app.register(healthRoutes, { prefix: API_BASE_PATH });
  app.register(authRoutes, { prefix: API_BASE_PATH, env, github, secretBox });
  app.register(cliLoginRoutes, { prefix: API_BASE_PATH, env });
  app.register(meRoutes, { prefix: API_BASE_PATH });
  app.register(tokenRoutes, { prefix: API_BASE_PATH });
  app.register(githubRoutes, { prefix: API_BASE_PATH, github, secretBox });
  const publicUrl = env.PUBLIC_URL;
  app.register(projectRoutes, {
    prefix: API_BASE_PATH,
    appsDomain: env.APPS_DOMAIN,
    github,
    secretBox,
    publicUrl,
  });
  app.register(serviceRoutes, {
    prefix: API_BASE_PATH,
    appsDomain: env.APPS_DOMAIN,
    github,
    secretBox,
    publicUrl,
  });
  app.register(deploymentRoutes, { prefix: API_BASE_PATH, github, secretBox, publicUrl });
  app.register(variableRoutes, { prefix: API_BASE_PATH, secretBox });
  app.register(memberRoutes, { prefix: API_BASE_PATH });
  app.register(editorRoutes, {
    prefix: API_BASE_PATH,
    github,
    secretBox,
    collab,
    collabSecret: env.COLLAB_SECRET,
  });
  app.register(databaseRoutes, { prefix: API_BASE_PATH, secretBox });
  app.register(webhookRoutes, { prefix: API_BASE_PATH, secretBox });
  app.register(cspReportRoutes, { prefix: API_BASE_PATH });
  app.register(planRoutes, {
    prefix: API_BASE_PATH,
    github,
    secretBox,
    agent,
    appsDomain: env.APPS_DOMAIN,
    publicUrl,
  });
  const heartbeatMs = options.sseHeartbeatMs ?? SSE_HEARTBEAT_MS;
  app.register(eventRoutes, { prefix: API_BASE_PATH, heartbeatMs });
  app.register(logRoutes, { prefix: API_BASE_PATH, heartbeatMs });

  // The worker's routes: reachable only on the private IP, never through Traefik.
  app.register(internalDeploymentRoutes, {
    prefix: INTERNAL_BASE_PATH,
    workerToken: env.WORKER_TOKEN,
    appsDomain: env.APPS_DOMAIN,
    secretBox,
  });
  app.register(internalDatabaseRoutes, {
    prefix: INTERNAL_BASE_PATH,
    workerToken: env.WORKER_TOKEN,
    secretBox,
  });
  // The agent service's routes (AI-06), with AGENT_SERVICE_TOKEN.
  app.register(internalAgentRoutes, {
    prefix: INTERNAL_BASE_PATH,
    agentToken: env.AGENT_SERVICE_TOKEN,
    github,
    secretBox,
    appsDomain: env.APPS_DOMAIN,
  });

  return app;
}

export type App = ReturnType<typeof buildServer>;
