import { randomBytes } from "node:crypto";
import { type Db, schema } from "@lift/db";
import {
  type ApplyPlanBody,
  type ApplyPlanResponse,
  type CreatePlanBody,
  type DeploymentTrigger,
  isReservedVariableKey,
  newId,
  OnboardingPlan,
  type PlanDatabase,
  type UpdateServiceBody,
} from "@lift/shared";
import { and, eq } from "drizzle-orm";
import { enqueueOp } from "../jobs/enqueue";
import { problem } from "../lib/problem";
import { accessProject, type ProjectRow } from "./access";
import type { AgentClient } from "./agent-client";
import { requireSecretBox, type SecretBox } from "./crypto";
import { createDatabaseRows, projectDatabases } from "./databases";
import { type DeploymentDeps, startDeployment } from "./deployments";
import { publishEvents } from "./events";
import type { Github } from "./github";
import { createProjectRows, deleteProjectRows, projectDetail } from "./projects";
import {
  createServiceRows,
  deleteServiceRows,
  type ServiceRow,
  updateServiceRows,
} from "./services";
import type { UserRow } from "./sessions";
import { githubTokenOf } from "./users";
import { upsertVariables } from "./variables";
import { ensureWebhook, removeWebhook } from "./webhooks";

const plans = schema.onboardingPlans;

export interface PlanDeps extends DeploymentDeps {
  github: Github;
  secretBox: SecretBox | null;
  agent: AgentClient;
  appsDomain: string;
  publicUrl: string;
}

/**
 * BE-19, `POST /agent/plans`: checks the user can read the repo and finds the commit (the branch's
 * head, or the `commitSha` given), then asks the agent to plan it and stores the plan as a draft.
 * The plan keeps the branch either way: it's what the service follows once the plan is applied.
 * The plan holds no value the user typed.
 */
export async function createPlan(
  deps: PlanDeps,
  user: UserRow,
  body: CreatePlanBody,
): Promise<OnboardingPlan> {
  const token = githubTokenOf(deps.secretBox, user);
  const repo = await deps.github.getRepo(token, body.owner, body.repo);
  if (!repo) {
    throw problem(
      "not_found",
      `You can't read ${body.owner}/${body.repo} on GitHub, or it doesn't exist.`,
      { fields: { repo: "Not found, or you have no access to it" } },
    );
  }
  const branch = body.branch ?? repo.defaultBranch;
  const noBranch = () =>
    problem("validation_failed", `${repo.owner}/${repo.name} has no branch ${branch}.`, {
      fields: { branch: "No such branch" },
    });
  // With a commit given, the branch isn't how the commit is found, so it's checked on its own.
  if (
    body.commitSha &&
    body.branch &&
    !(await deps.github.branchExists(token, repo.owner, repo.name, branch))
  ) {
    throw noBranch();
  }
  const commit = await deps.github.getCommit(
    token,
    repo.owner,
    repo.name,
    body.commitSha ?? branch,
  );
  if (!commit && body.commitSha) {
    throw problem(
      "validation_failed",
      `${repo.owner}/${repo.name} has no commit ${body.commitSha.slice(0, 7)}.`,
      { fields: { commitSha: "No such commit" } },
    );
  }
  if (!commit) throw noBranch();
  const draft = await deps.agent.plan(user.id, {
    owner: repo.owner,
    repo: repo.name,
    branch,
    commitSha: commit.sha,
  });
  const plan = OnboardingPlan.parse({ ...draft, id: newId("pln") });
  await deps.db.insert(plans).values({
    id: plan.id,
    userId: user.id,
    repoOwner: plan.repo.owner,
    repoName: plan.repo.name,
    commitSha: plan.repo.commitSha,
    plan,
    status: "draft",
  });
  deps.log.info({ planId: plan.id, repo: `${repo.owner}/${repo.name}` }, "plan stored");
  return plan;
}

/** A plan its creator asked for; anyone else gets 404. */
export async function findPlan(
  db: Db,
  userId: string,
  planId: string,
): Promise<{ plan: OnboardingPlan; status: string }> {
  const [row] = await db
    .select({ plan: plans.plan, status: plans.status })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, userId)))
    .limit(1);
  if (!row) throw problem("not_found", `No plan ${planId}.`);
  return { plan: OnboardingPlan.parse(row.plan), status: row.status };
}

/** The values apply writes: the plan's own choices (the agent's) and what the user typed. */
export interface PlannedValues {
  agent: Record<string, string>;
  user: Record<string, string>;
}

const generated = () => randomBytes(32).toString("base64url");

/**
 * Which value each of the plan's variables gets, or 400 with a field error for each problem:
 * - `generated`: 32 random bytes, made here and never stored in the plan;
 * - `default`: the plan's value, or the user's edit;
 * - `user`: the value the user typed, which a required one must have;
 * - `database`: written by the database once it's ready, so nothing here, unless it was turned
 *   off; then it's the user's to give, like any other.
 */
export function valuesFor(
  plan: OnboardingPlan,
  body: Pick<ApplyPlanBody, "values">,
  databaseOn: boolean,
  random: () => string = generated,
): PlannedValues {
  const service = plan.services[0]?.name;
  const variables = plan.variables.filter(
    (variable) => variable.service === service && !isReservedVariableKey(variable.key),
  );
  const typed = new Map(body.values.map((entry) => [`${entry.service}:${entry.key}`, entry.value]));
  const fields: Record<string, string> = {};
  const values: PlannedValues = { agent: {}, user: {} };
  for (const entry of body.values) {
    const variable = variables.find((candidate) => candidate.key === entry.key);
    if (entry.service !== service || !variable) {
      fields[`values.${entry.key}`] = `The plan doesn't ask for ${entry.key}`;
    } else if (variable.source === "generated" || (variable.source === "database" && databaseOn)) {
      fields[`values.${entry.key}`] = `Lift fills ${entry.key}`;
    }
  }
  for (const variable of variables) {
    const value = typed.get(`${variable.service}:${variable.key}`);
    const source = variable.source === "database" && !databaseOn ? "user" : variable.source;
    if (source === "database") continue;
    if (source === "generated") {
      values.agent[variable.key] = random();
    } else if (value !== undefined) {
      values.user[variable.key] = value;
    } else if (source === "default" && variable.value) {
      values.agent[variable.key] = variable.value;
    } else if (variable.required) {
      fields[`values.${variable.key}`] =
        variable.source === "database"
          ? `Turn the database on, or give ${variable.key} a value`
          : "Required";
    }
  }
  if (Object.keys(fields).length > 0) {
    throw problem("validation_failed", "Some values are missing or don't belong to this plan.", {
      fields,
    });
  }
  return values;
}

/** The databases left on: names the plan suggested, or 400. */
function databasesOn(plan: OnboardingPlan, body: Pick<ApplyPlanBody, "databases">): PlanDatabase[] {
  const unknown = body.databases.filter(
    (name) => !plan.databases.some((database) => database.name === name),
  );
  if (unknown.length > 0) {
    throw problem("validation_failed", `The plan has no database ${unknown.join(", ")}.`, {
      fields: { databases: `No database ${unknown.join(", ")} in the plan` },
    });
  }
  return plan.databases.filter(
    (database) => database.type === "postgres" && body.databases.includes(database.name),
  );
}

export interface ApplyInput {
  user: UserRow;
  planId: string;
  body: ApplyPlanBody;
  trigger: DeploymentTrigger;
}

/**
 * BE-20, `POST /agent/plans/:id/apply`. Everything that can be checked is checked first: the
 * values, the toggles, the project (editors) and that the user can still read the plan's commit.
 * Then the plan is claimed, so a second Approve gets 409 rather than a second project, and Lift
 * creates the project (or uses the one given), the service, its variables, Postgres if it's on
 * and the project has none, and the first deployment of the plan's commit. If a step fails, what
 * was made is removed again and the plan goes back to `draft`.
 */
export async function applyPlan(deps: PlanDeps, input: ApplyInput): Promise<ApplyPlanResponse> {
  const { user, body } = input;
  const { plan, status } = await findPlan(deps.db, user.id, input.planId);
  if (status !== "draft") throw problem("conflict", "This plan was already applied.");
  const planned = plan.services[0];
  if (!planned) throw problem("conflict", "This plan has no service to create.");
  const settings = { ...planned, ...body.service };
  const databases = databasesOn(plan, body);
  const values = valuesFor(plan, body, databases.length > 0);
  const secretBox = requireSecretBox(deps.secretBox);
  const token = githubTokenOf(deps.secretBox, user);
  const target = body.projectId
    ? await accessProject(deps.db, body.projectId, user.id, "editor")
    : null;
  const { owner, name: repoName, branch, commitSha } = plan.repo;
  const commit = await deps.github.getCommit(token, owner, repoName, commitSha);
  if (!commit) {
    throw problem(
      "conflict",
      `You can't read ${owner}/${repoName} on GitHub any more, or its commit ${commitSha.slice(0, 7)} is gone.`,
    );
  }

  const claimed = await deps.db
    .update(plans)
    .set({ status: "applied" })
    .where(and(eq(plans.id, plan.id), eq(plans.status, "draft")))
    .returning({ id: plans.id });
  if (claimed.length === 0) throw problem("conflict", "This plan was already applied.");

  let project: ProjectRow | null = target?.project ?? null;
  let newProject: ProjectRow | null = null;
  let service: ServiceRow | null = null;
  try {
    if (!project) {
      newProject = await createProjectRows(
        deps.db,
        user.id,
        (body.projectName ?? repoName).slice(0, 64),
      );
      project = newProject;
    }
    const created = await createServiceRows(deps.db, {
      project,
      actorId: user.id,
      body: {
        name: settings.name,
        repo: { owner, name: repoName },
        branch,
        rootDir: settings.rootDir,
        builder: "railpack",
        port: settings.port,
      },
      appsDomain: deps.appsDomain,
      secretBox,
    });
    service = created.row;
    const events = [created.event];
    const patch: UpdateServiceBody = {
      type: planned.type,
      buildCommand: settings.buildCommand,
      startCommand: settings.startCommand,
      healthcheckPath: settings.healthcheckPath,
    };
    events.push(
      (
        await updateServiceRows(deps.db, {
          service,
          actorId: user.id,
          patch,
          appsDomain: deps.appsDomain,
        })
      ).event,
    );
    service = { ...service, ...patch } as ServiceRow;
    await publishEvents(deps.redis, events, deps.log);
    await ensureWebhook({ ...deps, secretBox }, service, token);

    for (const [source, changes] of [
      ["agent", values.agent],
      ["user", values.user],
    ] as const) {
      if (Object.keys(changes).length === 0) continue;
      const event = await upsertVariables(deps.db, {
        service,
        secretBox,
        changes,
        actorId: user.id,
        source,
      });
      if (event) await publishEvents(deps.redis, [event], deps.log);
    }

    const [database] = databases;
    const existing = await projectDatabases(deps.db, project.id);
    if (database && !existing.some((row) => row.type === "postgres")) {
      const { row, event } = await createDatabaseRows(deps.db, {
        project,
        type: "postgres",
        name: database.name,
        actorId: user.id,
        secretBox,
      });
      await publishEvents(deps.redis, [event], deps.log);
      await enqueueOp(deps.queues, {
        op: "provision_db",
        databaseId: row.id,
        projectId: project.id,
        type: row.type,
      });
    }

    await startDeployment(deps, {
      service,
      trigger: input.trigger,
      commit,
      actor: { type: "user", id: user.id },
    });
    await deps.db.update(plans).set({ projectId: project.id }).where(eq(plans.id, plan.id));
  } catch (error) {
    await undo(deps, { user, token, newProject, service });
    await deps.db.update(plans).set({ status: "draft" }).where(eq(plans.id, plan.id));
    throw error;
  }
  deps.log.info({ planId: plan.id, projectId: project.id, serviceId: service.id }, "plan applied");
  return {
    project: await projectDetail(deps.db, project, target?.role ?? "owner", deps.appsDomain),
    serviceId: service.id,
  };
}

/** Removes what a failed apply made, the way the delete routes do. Best effort, and logged. */
async function undo(
  deps: PlanDeps,
  made: { user: UserRow; token: string; newProject: ProjectRow | null; service: ServiceRow | null },
): Promise<void> {
  const { user, newProject, service } = made;
  try {
    if (service) {
      const [fresh] = await deps.db
        .select()
        .from(schema.services)
        .where(eq(schema.services.id, service.id))
        .limit(1);
      if (fresh?.webhookId) await removeWebhook(deps, fresh, made.token);
    }
    if (newProject) {
      const removed = await deleteProjectRows(deps.db, { project: newProject, actorId: user.id });
      await publishEvents(deps.redis, [removed.event], deps.log);
      for (const row of removed.services) {
        await enqueueOp(deps.queues, {
          op: "remove_service",
          serviceId: row.id,
          projectId: newProject.id,
        });
      }
      for (const row of removed.databases) {
        await enqueueOp(deps.queues, {
          op: "deprovision_db",
          databaseId: row.id,
          projectId: newProject.id,
          type: row.type,
        });
      }
    } else if (service) {
      const event = await deleteServiceRows(deps.db, {
        service,
        actorId: user.id,
        appsDomain: deps.appsDomain,
      });
      await publishEvents(deps.redis, [event], deps.log);
      await enqueueOp(deps.queues, {
        op: "remove_service",
        serviceId: service.id,
        projectId: service.projectId,
      });
    }
  } catch (error) {
    deps.log.error({ err: error }, "couldn't undo a failed plan apply");
  }
}
