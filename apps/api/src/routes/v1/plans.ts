import {
  ApplyPlanBody,
  ApplyPlanResponse,
  CreatePlanBody,
  OnboardingPlan,
  OnboardingPlanId,
} from "@lift/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireUser, triggerFor } from "../../plugins/auth";
import type { AgentClient } from "../../services/agent-client";
import type { SecretBox } from "../../services/crypto";
import type { Github } from "../../services/github";
import { applyPlan, createPlan, findPlan, type PlanDeps } from "../../services/plans";

const PlanParams = z.object({ planId: OnboardingPlanId });

export interface PlanRoutesOptions {
  github: Github;
  secretBox: SecretBox | null;
  agent: AgentClient;
  appsDomain: string;
  publicUrl: string;
}

/**
 * BE-19 and BE-20: the assistant's plan for a repo (AI-03 makes it in the agent service), and
 * applying it. Plans are their creator's alone. With a token, both writes need the admin scope.
 */
export const planRoutes: FastifyPluginAsyncZod<PlanRoutesOptions> = async (app, options) => {
  const deps = (log: PlanDeps["log"]): PlanDeps => ({
    db: app.db,
    redis: app.redis,
    queues: app.queues,
    log,
    ...options,
  });

  app.post(
    "/agent/plans",
    {
      schema: {
        summary: "Plan how to deploy a repo; the assistant answers within a minute",
        description:
          "The assistant reads the repo at its branch head and proposes a service, a Postgres database if the code needs one, and the variables. The plan is stored as a draft.",
        tags: ["agent"],
        body: CreatePlanBody,
        response: { 201: OnboardingPlan },
      },
    },
    async (request, reply) => {
      const plan = await createPlan(deps(request.log), requireUser(request), request.body);
      reply.code(201);
      return plan;
    },
  );

  app.get(
    "/agent/plans/:planId",
    {
      schema: {
        summary: "A plan you asked for",
        tags: ["agent"],
        params: PlanParams,
        response: { 200: OnboardingPlan },
      },
    },
    async (request) => {
      const { plan } = await findPlan(app.db, requireUser(request).id, request.params.planId);
      return plan;
    },
  );

  app.post(
    "/agent/plans/:planId/apply",
    {
      schema: {
        summary: "Create what the plan says, then its first deployment",
        description:
          "With the review screen's edits, the databases left on and the values typed; the values go only into the service's encrypted variables. A plan applies once.",
        tags: ["agent"],
        params: PlanParams,
        body: ApplyPlanBody,
        response: { 201: ApplyPlanResponse },
      },
    },
    async (request, reply) => {
      const result = await applyPlan(deps(request.log), {
        user: requireUser(request),
        planId: request.params.planId,
        body: request.body,
        trigger: triggerFor(request),
      });
      reply.code(201);
      return result;
    },
  );
};
