import { type Db, schema } from "@lift/db";
import {
  type ActorType,
  type BuildJob,
  type DeployJob,
  type Deployment,
  type DeploymentDetail,
  type DeploymentErrorCode,
  type DeploymentStatus,
  type DeploymentStatusReport,
  type DeploymentTrigger,
  isLiftApiError,
  newId,
  type ProjectRole,
} from "@lift/shared";
import { and, asc, desc, eq, inArray, isNull, max } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import { dropQueuedBuild, enqueueBuild, enqueueDeploy } from "../jobs/enqueue";
import { problem } from "../lib/problem";
import type { Queues } from "../plugins/queues";
import { accessProject, type ProjectRow } from "./access";
import { canTransition } from "./deployment-state";
import { type DbOrTx, type EventRow, publishEvents, recordEvent } from "./events";
import type { Github, GithubCommit } from "./github";
import { finishLogs } from "./logs";
import type { ServiceRow } from "./services";

export type DeploymentRow = typeof schema.deployments.$inferSelect;

/** What deployments need from the server: the database, Redis for events, and the queues. */
export interface DeploymentDeps {
  db: Db;
  redis: Redis;
  queues: Queues;
  log: FastifyBaseLogger;
}

/** Who changed a deployment, for the events table. */
export interface Actor {
  type: ActorType;
  id: string | null;
}

const WORKER: Actor = { type: "worker", id: null };
const SYSTEM: Actor = { type: "system", id: null };

/** How long a deployment may go without a status update (docs/prd/01-backend-api.md). */
export const STUCK_AFTER_MS = { building: 20 * 60_000, deploying: 5 * 60_000 } as const;

export function toDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
    serviceId: row.serviceId,
    projectId: row.projectId,
    status: row.status,
    trigger: row.trigger,
    commitSha: row.commitSha,
    commitMessage: row.commitMessage,
    commitAuthor: row.commitAuthor,
    imageTag: row.imageTag,
    containerId: row.containerId,
    rollbackOf: row.rollbackOf,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdByUserId: row.createdByUserId,
    createdByActionId: row.createdByActionId,
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const d = schema.deployments;
const timeline = schema.deploymentEvents;

/** One status change inside a transaction: the row, its timeline step and its event. */
async function changeStatus(
  tx: DbOrTx,
  row: DeploymentRow,
  to: DeploymentStatus,
  input: { at: Date; message: string | null; actor: Actor; set?: Partial<DeploymentRow> },
): Promise<{ row: DeploymentRow; event: EventRow }> {
  const [updated] = await tx
    .update(d)
    .set({ ...input.set, status: to })
    .where(eq(d.id, row.id))
    .returning();
  if (!updated) throw new Error(`deployment ${row.id} vanished`);
  await tx.insert(timeline).values({
    id: newId("dpe"),
    deploymentId: row.id,
    status: to,
    message: input.message,
    at: input.at,
  });
  const event = await recordEvent(tx, {
    projectId: row.projectId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    type: "deployment.status_changed",
    data: { ...toDeployment(updated), previousStatus: row.status },
  });
  return { row: updated, event };
}

/** The build job for a deployment of a service. */
export function buildJobFor(row: DeploymentRow, service: ServiceRow): BuildJob {
  return {
    deploymentId: row.id,
    serviceId: service.id,
    projectId: service.projectId,
    repo: { owner: service.repoOwner, name: service.repoName, branch: service.branch },
    commitSha: row.commitSha,
    rootDir: service.rootDir,
    builder: service.builder,
    ...(service.dockerfilePath ? { dockerfilePath: service.dockerfilePath } : {}),
  };
}

/**
 * The commit to deploy: `sha` when given, otherwise the branch head, read with the caller's
 * GitHub token. An unknown SHA points at the `commitSha` field.
 */
export async function resolveCommit(
  github: Github,
  token: string,
  service: ServiceRow,
  sha?: string,
): Promise<GithubCommit> {
  const repo = `${service.repoOwner}/${service.repoName}`;
  const ref = sha ?? service.branch;
  const commit = await github.getCommit(token, service.repoOwner, service.repoName, ref);
  if (commit) return commit;
  if (sha) {
    throw problem("validation_failed", `${repo} has no commit ${sha}.`, {
      fields: { commitSha: "No such commit in this repo" },
    });
  }
  throw problem(
    "github_error",
    `Couldn't read the head of ${service.branch} in ${repo}: the branch is gone, or you can't read the repo.`,
  );
}

export interface NewDeployment {
  service: ServiceRow;
  trigger: DeploymentTrigger;
  commit: GithubCommit;
  actor: Actor;
}

/**
 * Inserts a `queued` deployment with its first timeline step and `deployment.created`, and
 * cancels the service's older queued deployments: newest wins. Locking the service row first
 * means two triggers at once can't both stay queued.
 */
export async function createDeploymentRows(
  db: Db,
  input: NewDeployment,
): Promise<{ row: DeploymentRow; events: EventRow[]; canceled: DeploymentRow[] }> {
  const { service, commit, actor } = input;
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.services.id })
      .from(schema.services)
      .where(eq(schema.services.id, service.id))
      .for("update");
    const now = new Date();
    const events: EventRow[] = [];
    const canceled: DeploymentRow[] = [];
    const queued = await tx
      .select()
      .from(d)
      .where(and(eq(d.serviceId, service.id), eq(d.status, "queued")));
    for (const old of queued) {
      const change = await changeStatus(tx, old, "canceled", {
        at: now,
        message: "Replaced by a newer deployment",
        actor,
        set: { finishedAt: now },
      });
      events.push(change.event);
      canceled.push(change.row);
    }
    const [row] = await tx
      .insert(d)
      .values({
        id: newId("dep"),
        serviceId: service.id,
        projectId: service.projectId,
        status: "queued",
        trigger: input.trigger,
        commitSha: commit.sha,
        commitMessage: commit.message,
        commitAuthor: commit.author,
        createdByUserId: actor.type === "user" ? actor.id : null,
        queuedAt: now,
      })
      .returning();
    if (!row) throw new Error("insert returned no deployment");
    await tx.insert(timeline).values({
      id: newId("dpe"),
      deploymentId: row.id,
      status: "queued",
      message: null,
      at: now,
    });
    events.push(
      await recordEvent(tx, {
        projectId: row.projectId,
        actorType: actor.type,
        actorId: actor.id,
        type: "deployment.created",
        data: toDeployment(row),
      }),
    );
    return { row, events, canceled };
  });
}

/**
 * Fails a deployment that is still in progress, from outside the worker: the backstop, or a job
 * that couldn't be queued. Returns null when it has already moved on.
 */
export async function failDeployment(
  deps: DeploymentDeps,
  deploymentId: string,
  failure: { code: DeploymentErrorCode; message: string; actor?: Actor },
): Promise<DeploymentRow | null> {
  const result = await deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(d).where(eq(d.id, deploymentId)).for("update");
    if (!row || !canTransition(row.status, "failed")) return null;
    const now = new Date();
    return changeStatus(tx, row, "failed", {
      at: now,
      message: failure.message,
      actor: failure.actor ?? SYSTEM,
      set: { errorCode: failure.code, errorMessage: failure.message, finishedAt: now },
    });
  });
  if (!result) return null;
  await publishEvents(deps.redis, [result.event], deps.log);
  await finishLogs(deps, deploymentId, "failed");
  return result.row;
}

/**
 * Creates a deployment and queues its build. If the build can't be queued (Redis is down), the
 * deployment fails at once with `upstream_unavailable` instead of waiting forever.
 */
export async function startDeployment(
  deps: DeploymentDeps,
  input: NewDeployment,
): Promise<DeploymentRow> {
  const { row, events, canceled } = await createDeploymentRows(deps.db, input);
  await publishEvents(deps.redis, events, deps.log);
  for (const old of canceled) {
    await dropQueuedBuild(deps.queues, old.id);
    await finishLogs(deps, old.id, "canceled");
  }
  try {
    await enqueueBuild(deps.queues, buildJobFor(row, input.service));
  } catch (error) {
    deps.log.error({ err: error, deploymentId: row.id }, "couldn't queue a build");
    await failDeployment(deps, row.id, {
      code: "upstream_unavailable",
      message: "Lift couldn't queue the build. Try again.",
    });
    throw problem("upstream_unavailable", "Lift couldn't queue the build. Try again.", {
      cause: error,
    });
  }
  return row;
}

/** Hostnames a deployment answers on: the service's active domains. */
async function hostnamesOf(tx: DbOrTx, serviceId: string): Promise<string[]> {
  const rows = await tx
    .select({ hostname: schema.domains.hostname })
    .from(schema.domains)
    .where(and(eq(schema.domains.serviceId, serviceId), eq(schema.domains.status, "active")))
    .orderBy(asc(schema.domains.createdAt));
  return rows.map((row) => row.hostname);
}

/**
 * Applies a worker's status report (`POST /internal/v1/deployments/:id/status`) under a row lock.
 * A repeat changes nothing; a report the state machine refuses gets 409, and so does any report
 * but `failed` for a deleted service. `deploying` queues the deploy job; `active` first
 * supersedes the service's previous active deployment, whose container the worker then removes.
 */
export async function applyReport(
  deps: DeploymentDeps,
  deploymentId: string,
  report: DeploymentStatusReport,
): Promise<DeploymentRow> {
  const result = await deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(d).where(eq(d.id, deploymentId)).for("update");
    if (!row) throw problem("not_found", `No deployment ${deploymentId}.`);
    if (row.status === report.status) return { row, events: [], deployJob: null };
    if (!canTransition(row.status, report.status)) {
      throw problem(
        "conflict",
        `Deployment ${deploymentId} is ${row.status}, so it can't become ${report.status}.`,
      );
    }
    const [service] = await tx
      .select()
      .from(schema.services)
      .where(eq(schema.services.id, row.serviceId))
      .limit(1);
    if (!service) throw new Error(`deployment ${row.id} has no service`);
    if (service.deletedAt && report.status !== "failed") {
      throw problem("conflict", `Service ${service.id} was deleted; stop this deployment.`);
    }
    const at = new Date(report.at);
    const message = report.message ?? null;
    const step = { at, message, actor: WORKER };
    switch (report.status) {
      case "building": {
        const change = await changeStatus(tx, row, "building", { ...step, set: { startedAt: at } });
        return { row: change.row, events: [change.event], deployJob: null };
      }
      case "deploying": {
        const change = await changeStatus(tx, row, "deploying", {
          ...step,
          set: { imageTag: report.imageTag },
        });
        const deployJob: DeployJob = {
          deploymentId: row.id,
          serviceId: service.id,
          serviceSlug: service.slug,
          projectId: service.projectId,
          imageTag: report.imageTag,
          port: service.port,
          healthcheckPath: service.healthcheckPath,
          cpu: service.cpu,
          memoryMb: service.memoryMb,
          hostnames: await hostnamesOf(tx, service.id),
        };
        return { row: change.row, events: [change.event], deployJob };
      }
      case "active": {
        const events: EventRow[] = [];
        const previous = await tx
          .select()
          .from(d)
          .where(and(eq(d.serviceId, row.serviceId), eq(d.status, "active")))
          .for("update");
        for (const old of previous) {
          const change = await changeStatus(tx, old, "superseded", {
            ...step,
            message: `Replaced by ${row.id}`,
          });
          events.push(change.event);
        }
        const change = await changeStatus(tx, row, "active", {
          ...step,
          set: { containerId: report.containerId, finishedAt: at },
        });
        events.push(change.event);
        return { row: change.row, events, deployJob: null };
      }
      case "failed": {
        const change = await changeStatus(tx, row, "failed", {
          ...step,
          set: { errorCode: report.errorCode, errorMessage: message, finishedAt: at },
        });
        // Autofix (`lift-agent` → `autofix`) is queued here once the agent service consumes it
        // (Nov 24); until then a queued job would wait for days and then fix a stale failure.
        return { row: change.row, events: [change.event], deployJob: null };
      }
    }
  });
  await publishEvents(deps.redis, result.events, deps.log);
  const changed = result.events.length > 0;
  if (changed && (result.row.status === "active" || result.row.status === "failed")) {
    await finishLogs(deps, deploymentId, result.row.status);
  }
  if (result.deployJob) {
    try {
      await enqueueDeploy(deps.queues, result.deployJob);
    } catch (error) {
      deps.log.error({ err: error, deploymentId }, "couldn't queue a deploy");
      const failed = await failDeployment(deps, deploymentId, {
        code: "upstream_unavailable",
        message: "Lift couldn't queue the deploy. Deploy again.",
      });
      return failed ?? result.row;
    }
  }
  return result.row;
}

/**
 * The backstop: fails deployments with no status update for 20 minutes while building or 5
 * while deploying (the worker died, or lost its job). Runs every minute; returns the IDs failed.
 */
export async function failStuckDeployments(
  deps: DeploymentDeps,
  now: Date = new Date(),
): Promise<string[]> {
  const inProgress = await deps.db
    .select({ id: d.id, status: d.status, lastAt: max(timeline.at) })
    .from(d)
    .innerJoin(timeline, eq(timeline.deploymentId, d.id))
    .where(inArray(d.status, ["building", "deploying"]))
    .groupBy(d.id, d.status);
  const failed: string[] = [];
  for (const { id, status, lastAt } of inProgress) {
    if (status !== "building" && status !== "deploying") continue;
    const limit = STUCK_AFTER_MS[status];
    if (!lastAt || now.getTime() - lastAt.getTime() < limit) continue;
    const row = await failDeployment(deps, id, {
      code: "upstream_unavailable",
      message: `The worker sent no update for ${limit / 60_000} minutes while ${status}.`,
    });
    if (row) failed.push(id);
  }
  return failed;
}

/** A deployment, after checking the caller's role in its project (404 for non-members). */
export async function accessDeployment(
  db: Db,
  deploymentId: string,
  userId: string,
  needed: ProjectRole = "viewer",
): Promise<{ deployment: DeploymentRow; project: ProjectRow; role: ProjectRole }> {
  const [deployment] = await db
    .select({ deployment: d })
    .from(d)
    .innerJoin(schema.services, eq(schema.services.id, d.serviceId))
    .where(and(eq(d.id, deploymentId), isNull(schema.services.deletedAt)))
    .limit(1);
  if (!deployment) throw problem("not_found", `No deployment ${deploymentId}.`);
  try {
    return {
      deployment: deployment.deployment,
      ...(await accessProject(db, deployment.deployment.projectId, userId, needed)),
    };
  } catch (error) {
    if (isLiftApiError(error) && error.code === "not_found") {
      throw problem("not_found", `No deployment ${deploymentId}.`);
    }
    throw error;
  }
}

/** A service's deployments, newest first. */
export async function listDeployments(
  db: Db,
  serviceId: string,
  page: { limit: number; offset: number },
): Promise<DeploymentRow[]> {
  return db
    .select()
    .from(d)
    .where(eq(d.serviceId, serviceId))
    .orderBy(desc(d.queuedAt), desc(d.id))
    .limit(page.limit)
    .offset(page.offset);
}

/** `GET /deployments/:id`: the deployment with its timeline, oldest step first. */
export async function deploymentDetail(db: Db, row: DeploymentRow): Promise<DeploymentDetail> {
  const steps = await db
    .select()
    .from(timeline)
    .where(eq(timeline.deploymentId, row.id))
    .orderBy(asc(timeline.at), asc(timeline.createdAt));
  return {
    ...toDeployment(row),
    timeline: steps.map((step) => ({
      id: step.id,
      status: step.status,
      message: step.message,
      at: step.at.toISOString(),
    })),
  };
}
