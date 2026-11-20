import { type Db, schema } from "@lift/db";
import {
  type ActorType,
  AUTOFIX_ERROR_CODES,
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
  rollbackTarget,
  type Service,
} from "@lift/shared";
import { and, asc, desc, eq, inArray, isNull, max } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import {
  dropQueuedBuild,
  enqueueAutofix,
  enqueueBuild,
  enqueueDeploy,
  enqueueOp,
} from "../jobs/enqueue";
import { problem } from "../lib/problem";
import type { Queues } from "../plugins/queues";
import { accessProject, type ProjectRow } from "./access";
import { canTransition } from "./deployment-state";
import { type DbOrTx, type EventRow, publishEvents, recordEvent } from "./events";
import type { Github, GithubCommit } from "./github";
import { appendSystemLine, finishLogs } from "./logs";
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
  /** The agent action that asked for it: an autofix redeploy (AI-06). */
  createdByActionId?: string;
}

/**
 * Inserts a `queued` deployment with its first timeline step and `deployment.created`, and
 * cancels the service's older queued deployments: newest wins. Locking the service row first
 * means two triggers at once can't both stay queued. A push or an editor commit deploys a commit
 * once: a redelivered push, or the push that follows an editor commit, returns null and changes
 * nothing (the `deployments_push_editor_dedup` index agrees).
 */
export async function createDeploymentRows(
  db: Db,
  input: NewDeployment,
): Promise<{ row: DeploymentRow; events: EventRow[]; canceled: DeploymentRow[] } | null> {
  const { service, commit, actor } = input;
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.services.id })
      .from(schema.services)
      .where(eq(schema.services.id, service.id))
      .for("update");
    if (input.trigger === "push" || input.trigger === "editor") {
      const [already] = await tx
        .select({ id: d.id })
        .from(d)
        .where(
          and(
            eq(d.serviceId, service.id),
            eq(d.commitSha, commit.sha),
            inArray(d.trigger, ["push", "editor"]),
          ),
        )
        .limit(1);
      if (already) return null;
    }
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
        createdByActionId: input.createdByActionId ?? null,
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
 * Creates a deployment and queues its build; null when a push or editor commit was already
 * deployed. If the build can't be queued (Redis is down), the deployment fails at once with
 * `upstream_unavailable` instead of waiting forever.
 */
export async function startDeployment(
  deps: DeploymentDeps,
  input: NewDeployment,
): Promise<DeploymentRow | null> {
  const row = await createDeployment(deps, input);
  if (row) await queueBuild(deps, row, input.service);
  return row;
}

/**
 * The first half of `startDeployment`: the `queued` deployment and its events, with no build yet.
 * An editor commit creates its deployment before the branch moves, so the push webhook that
 * follows always finds it (BE-18), and queues the build once the branch has moved.
 */
export async function createDeployment(
  deps: DeploymentDeps,
  input: NewDeployment,
): Promise<DeploymentRow | null> {
  const created = await createDeploymentRows(deps.db, input);
  if (!created) return null;
  const { row, events, canceled } = created;
  await publishEvents(deps.redis, events, deps.log);
  for (const old of canceled) {
    await dropQueuedBuild(deps.queues, old.id);
    await finishLogs(deps, old.id, "canceled");
  }
  return row;
}

/** The second half of `startDeployment`: queues the build, or fails the deployment at once. */
export async function queueBuild(
  deps: DeploymentDeps,
  row: DeploymentRow,
  service: ServiceRow,
): Promise<void> {
  try {
    await enqueueBuild(deps.queues, buildJobFor(row, service));
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
}

/**
 * The deploy job for an image, from the service's settings and domains as they are now: a
 * finished build's, or a rollback's, which runs an old image with today's settings.
 */
async function deployJobFor(
  tx: DbOrTx,
  service: ServiceRow,
  deploymentId: string,
  imageTag: string,
): Promise<DeployJob> {
  return {
    deploymentId,
    serviceId: service.id,
    serviceSlug: service.slug,
    projectId: service.projectId,
    imageTag,
    port: service.port,
    healthcheckPath: service.healthcheckPath,
    cpu: service.cpu,
    memoryMb: service.memoryMb,
    hostnames: await hostnamesOf(tx, service.id),
  };
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
        const deployJob = await deployJobFor(tx, service, row.id, report.imageTag);
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
        // AI-06: the app's own failures go to autofix, on a service that has it on.
        const autofix =
          service.autofix &&
          !service.deletedAt &&
          (AUTOFIX_ERROR_CODES as readonly string[]).includes(report.errorCode);
        return { row: change.row, events: [change.event], deployJob: null, autofix };
      }
    }
  });
  await publishEvents(deps.redis, result.events, deps.log);
  const changed = result.events.length > 0;
  if (changed && (result.row.status === "active" || result.row.status === "failed")) {
    await finishLogs(deps, deploymentId, result.row.status);
  }
  if (changed && "autofix" in result && result.autofix) {
    // After finishLogs, so the agent reads the whole log. A queue that's down only costs the
    // diagnosis: the deployment has failed either way.
    await enqueueAutofix(deps.queues, { deploymentId }).catch((error) =>
      deps.log.error({ err: error, deploymentId }, "couldn't queue autofix"),
    );
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

/**
 * `POST /deployments/:id/rollback` (docs/prd/01-backend-api.md, "Deployments"): a new deployment
 * that starts at `deploying` with the target's image, commit and `rollback_of`, and goes straight
 * to the deploy job: no build. It runs with today's variables and settings. Older queued
 * deployments are canceled (newest wins); a build already running is left to finish. The target
 * must pass the shared rollback rule, so its image is one Lift keeps.
 */
export async function rollbackDeployment(
  deps: DeploymentDeps,
  input: { service: ServiceRow; target: DeploymentRow; actor: Actor },
): Promise<DeploymentRow> {
  const { service, target, actor } = input;
  const created = await deps.db.transaction(async (tx) => {
    await tx
      .select({ id: schema.services.id })
      .from(schema.services)
      .where(eq(schema.services.id, service.id))
      .for("update");
    const all = await tx
      .select({ id: d.id, status: d.status, imageTag: d.imageTag, createdAt: d.createdAt })
      .from(d)
      .where(eq(d.serviceId, service.id));
    const images = all.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
    const [current] = images.filter((row) => row.id === target.id);
    const check = rollbackTarget(
      current ?? { ...target, createdAt: target.createdAt.toISOString() },
      images,
    );
    if (!check.ok || !target.imageTag) {
      throw problem("conflict", check.ok ? "This deployment has no image." : check.reason);
    }
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
        message: "Replaced by a rollback",
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
        status: "deploying",
        trigger: "rollback",
        commitSha: target.commitSha,
        commitMessage: target.commitMessage,
        commitAuthor: target.commitAuthor,
        imageTag: target.imageTag,
        rollbackOf: target.id,
        createdByUserId: actor.type === "user" ? actor.id : null,
        queuedAt: now,
        startedAt: now,
      })
      .returning();
    if (!row) throw new Error("insert returned no deployment");
    await tx.insert(timeline).values({
      id: newId("dpe"),
      deploymentId: row.id,
      status: "deploying",
      message: `Rolling back to ${target.commitSha.slice(0, 7)} (${target.id})`,
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
    const job = await deployJobFor(tx, service, row.id, target.imageTag);
    return { row, events, canceled, job };
  });
  const { row, events, canceled, job } = created;
  await publishEvents(deps.redis, events, deps.log);
  for (const old of canceled) {
    await dropQueuedBuild(deps.queues, old.id);
    await finishLogs(deps, old.id, "canceled");
  }
  await appendSystemLine(
    deps,
    row.id,
    `Rolling back to ${target.commitSha.slice(0, 7)} (${target.id}): its image runs with today's variables and settings. No build runs.`,
  );
  try {
    await enqueueDeploy(deps.queues, job);
  } catch (error) {
    deps.log.error({ err: error, deploymentId: row.id }, "couldn't queue a rollback");
    await failDeployment(deps, row.id, {
      code: "upstream_unavailable",
      message: "Lift couldn't queue the rollback. Try again.",
    });
    throw problem("upstream_unavailable", "Lift couldn't queue the rollback. Try again.", {
      cause: error,
    });
  }
  return row;
}

/**
 * `POST /deployments/:id/cancel`: only while it's queued or building. A queued build job is
 * dropped; a running build gets a `stop` op, and its next report gets 409 anyway. The log ends.
 */
export async function cancelDeployment(
  deps: DeploymentDeps,
  input: { deployment: DeploymentRow; actor: Actor; by: string; message?: string },
): Promise<DeploymentRow> {
  const result = await deps.db.transaction(async (tx) => {
    const [row] = await tx.select().from(d).where(eq(d.id, input.deployment.id)).for("update");
    if (!row) throw problem("not_found", `No deployment ${input.deployment.id}.`);
    if (row.status !== "queued" && row.status !== "building") {
      throw problem(
        "conflict",
        `This deployment is ${row.status}; only a queued or building one can be canceled.`,
      );
    }
    const now = new Date();
    const change = await changeStatus(tx, row, "canceled", {
      at: now,
      message: input.message ?? `Canceled by ${input.by}`,
      actor: input.actor,
      set: { finishedAt: now },
    });
    return { change, was: row.status };
  });
  const { change, was } = result;
  await publishEvents(deps.redis, [change.event], deps.log);
  if (was === "queued") {
    await dropQueuedBuild(deps.queues, change.row.id);
  } else {
    await enqueueOp(deps.queues, {
      op: "stop",
      deploymentId: change.row.id,
      serviceId: change.row.serviceId,
      projectId: change.row.projectId,
    });
  }
  await finishLogs(deps, change.row.id, "canceled");
  return change.row;
}

/**
 * `POST /services/:id/restart`: the worker restarts the active deployment's container, with the
 * same image and variables. 409 when nothing is running.
 */
export async function restartService(
  deps: DeploymentDeps,
  input: { service: ServiceRow; view: Service; actor: Actor },
): Promise<void> {
  const { service } = input;
  const [active] = await deps.db
    .select()
    .from(d)
    .where(and(eq(d.serviceId, service.id), eq(d.status, "active")))
    .limit(1);
  if (!active) throw problem("conflict", `${service.name} has nothing running to restart.`);
  await enqueueOp(deps.queues, {
    op: "restart",
    deploymentId: active.id,
    serviceId: service.id,
    projectId: service.projectId,
  });
  const event = await recordEvent(deps.db, {
    projectId: service.projectId,
    actorType: input.actor.type,
    actorId: input.actor.id,
    type: "service.restarted",
    data: input.view,
  });
  await publishEvents(deps.redis, [event], deps.log);
}
