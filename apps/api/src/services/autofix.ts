import { type Db, schema } from "@lift/db";
import {
  AgentAction,
  AUTOFIX_MAX_FIXES,
  type AutofixChange,
  type AutofixContext,
  allowedChange,
  type CreateDiagnosisBody,
  Diagnosis,
  type DiagnosisAction,
  describeChange,
  envExamplePaths,
  FailureCategory,
  newId,
  parseEnvExample,
  StoredVariableSource,
} from "@lift/shared";
import { and, desc, eq } from "drizzle-orm";
import { problem } from "../lib/problem";
import { requireSecretBox, type SecretBox } from "./crypto";
import { type DeploymentDeps, startDeployment, toDeployment } from "./deployments";
import { type DbOrTx, type EventRow, publishEvents, recordEvent } from "./events";
import type { Github } from "./github";
import { type ServiceRow, toService } from "./services";
import type { UserRow } from "./sessions";
import { githubTokenOf } from "./users";

const d = schema.deployments;
const actionsTable = schema.agentActions;
const diagnoses = schema.diagnoses;

type DeploymentRow = typeof schema.deployments.$inferSelect;
type ActionRow = typeof schema.agentActions.$inferSelect;
type DiagnosisRow = typeof schema.diagnoses.$inferSelect;

export interface AutofixDeps extends DeploymentDeps {
  github: Github;
  secretBox: SecretBox | null;
  appsDomain: string;
}

export function toDiagnosis(row: DiagnosisRow): Diagnosis {
  return Diagnosis.parse({
    id: row.id,
    deploymentId: row.deploymentId,
    category: row.category,
    summary: row.summary,
    evidence: row.evidence,
    actions: row.actions,
    attempt: row.attempt,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  });
}

function toAgentAction(row: ActionRow): AgentAction {
  return AgentAction.parse({
    id: row.id,
    sessionId: row.sessionId,
    projectId: row.projectId,
    kind: row.kind,
    tool: row.tool,
    args: row.args,
    status: row.status,
    requiresApproval: row.requiresApproval,
    result: row.result,
    createdAt: row.createdAt.toISOString(),
  });
}

/** A deployment's diagnosis, or null before autofix wrote one. */
export async function findDiagnosis(db: Db, deploymentId: string): Promise<Diagnosis | null> {
  const [row] = await db.select().from(diagnoses).where(eq(diagnoses.deploymentId, deploymentId));
  return row ? toDiagnosis(row) : null;
}

interface Chain {
  /** The chain's `agent_sessions` row, once autofix redeployed in it. */
  sessionId: string | null;
  attempt: number;
  previousCategory: FailureCategory | null;
}

/**
 * Where a failure sits in a chain of autofix redeploys. A deployment autofix started carries its
 * `deploy` action, whose session is the chain: the attempt is one more than the chain's
 * redeploys, and the previous category is the diagnosis of the failure that redeploy fixed.
 */
async function chainOf(db: Db, deployment: DeploymentRow): Promise<Chain> {
  const first: Chain = { sessionId: null, attempt: 1, previousCategory: null };
  if (!deployment.createdByActionId) return first;
  const [action] = await db
    .select()
    .from(actionsTable)
    .where(eq(actionsTable.id, deployment.createdByActionId))
    .limit(1);
  if (!action?.sessionId || action.kind !== "autofix") return first;
  const redeploys = await db
    .select({ id: actionsTable.id })
    .from(actionsTable)
    .where(and(eq(actionsTable.sessionId, action.sessionId), eq(actionsTable.tool, "deploy")));
  const from = (action.args as { fromDeploymentId?: unknown }).fromDeploymentId;
  const [previous] =
    typeof from === "string"
      ? await db
          .select({ category: diagnoses.category })
          .from(diagnoses)
          .where(eq(diagnoses.deploymentId, from))
          .limit(1)
      : [];
  const category = FailureCategory.safeParse(previous?.category);
  return {
    sessionId: action.sessionId,
    attempt: redeploys.length + 1,
    previousCategory: category.success ? category.data : null,
  };
}

/** The failed deployment with its live service, project owner and whether a newer one exists. */
async function failureOf(db: Db, deploymentId: string) {
  const [row] = await db.select().from(d).where(eq(d.id, deploymentId)).limit(1);
  if (!row) throw problem("not_found", `No deployment ${deploymentId}.`);
  const [service] = await db
    .select()
    .from(schema.services)
    .where(eq(schema.services.id, row.serviceId))
    .limit(1);
  if (!service || service.deletedAt)
    throw problem("not_found", `Service ${row.serviceId} is gone.`);
  const [project] = await db
    .select({ ownerId: schema.projects.ownerId })
    .from(schema.projects)
    .where(eq(schema.projects.id, row.projectId))
    .limit(1);
  if (!project) throw problem("not_found", `Project ${row.projectId} is gone.`);
  // The service's latest deployment, ordered in Postgres: its timestamps have microseconds, more
  // than a JavaScript Date keeps, so comparing them here would count this deployment as newer.
  const [latest] = await db
    .select({ id: d.id })
    .from(d)
    .where(eq(d.serviceId, row.serviceId))
    .orderBy(desc(d.createdAt), desc(d.id))
    .limit(1);
  const variables = await db
    .select({ key: schema.variables.key, source: schema.variables.source })
    .from(schema.variables)
    .where(eq(schema.variables.serviceId, service.id));
  return {
    row,
    service,
    ownerId: project.ownerId,
    newest: latest?.id === row.id,
    variables: variables.map((variable) => ({
      key: variable.key,
      source: StoredVariableSource.parse(variable.source),
    })),
  };
}

/** `GET /internal/v1/agent/autofix/:deploymentId/context` (AI-06). */
export async function autofixContext(
  db: Db,
  appsDomain: string,
  deploymentId: string,
): Promise<AutofixContext> {
  const failure = await failureOf(db, deploymentId);
  const chain = await chainOf(db, failure.row);
  return {
    deployment: toDeployment(failure.row),
    service: toService(failure.service, appsDomain),
    actAs: failure.ownerId,
    variables: failure.variables,
    chain: { attempt: chain.attempt, previousCategory: chain.previousCategory },
    newest: failure.newest,
  };
}

const SPECIAL_VARIABLE = /^(?:RAILPACK_NODE_VERSION|RAILPACK_PYTHON_VERSION|NPM_CONFIG_\w+)$/;

/**
 * The repo's example env values at the failed commit, read again with the owner's GitHub token:
 * the API checks a safe default against the repo itself, not against what the agent says.
 */
async function envExampleAt(
  deps: AutofixDeps,
  owner: UserRow,
  service: ServiceRow,
  sha: string,
): Promise<Record<string, string>> {
  const token = githubTokenOf(deps.secretBox, owner);
  for (const path of envExamplePaths(service.rootDir)) {
    const found = await deps.github.getContents(
      token,
      service.repoOwner,
      service.repoName,
      path,
      sha,
    );
    if (found.kind === "file") return parseEnvExample(found.file.content);
  }
  return {};
}

/** Sets a variable as the agent's, encrypted, in the caller's transaction. */
async function setAgentVariable(
  tx: DbOrTx,
  secretBox: SecretBox,
  serviceId: string,
  key: string,
  value: string,
): Promise<void> {
  const v = schema.variables;
  const valueEnc = secretBox.encrypt(value);
  const now = new Date();
  await tx
    .insert(v)
    .values({
      id: newId("var"),
      serviceId,
      key,
      valueEnc,
      source: "agent",
      databaseId: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [v.serviceId, v.key],
      set: { valueEnc, source: "agent", databaseId: null, updatedAt: now },
    });
}

/**
 * `POST /internal/v1/agent/diagnoses` (AI-06, PRD 03 step 6). The API decides what happens:
 * - changes apply only while the deployment is still the service's newest, its autofix is on and
 *   the chain has fixes left; otherwise they're recorded as proposals;
 * - each change is checked again with the same rules the agent used (a safe default against the
 *   repo's own `.env.example`), and one that fails them refuses the whole request;
 * - in one transaction: the chain's session, an action per change and per proposal, the settings
 *   and variables, and the diagnosis; then the redeploy of the same commit, linked to the chain
 *   through its `deploy` action from the moment it exists.
 * Values are stored only encrypted: an action's arguments name the variables, never their values.
 */
export async function createDiagnosis(
  deps: AutofixDeps,
  body: CreateDiagnosisBody,
): Promise<Diagnosis> {
  const { db } = deps;
  const failure = await failureOf(db, body.deploymentId);
  const { row, service } = failure;
  if (row.status !== "failed") {
    throw problem("conflict", `Deployment ${row.id} is ${row.status}, not failed.`);
  }
  if ((await findDiagnosis(db, row.id)) !== null) {
    throw problem("conflict", `Deployment ${row.id} already has a diagnosis.`);
  }
  const chain = await chainOf(db, row);
  const canApply = failure.newest && service.autofix && chain.attempt <= AUTOFIX_MAX_FIXES;
  const changes: AutofixChange[] = canApply ? body.changes : [];
  const proposals: AutofixChange[] = canApply
    ? body.proposals
    : [...body.changes, ...body.proposals];

  if (changes.length > 0) {
    const [owner] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, failure.ownerId))
      .limit(1);
    if (!owner) throw problem("conflict", "The project's owner is gone.");
    const needsExample = changes.some(
      (change) => change.kind === "variable" && !SPECIAL_VARIABLE.test(change.key),
    );
    const facts = {
      service: {
        port: service.port,
        healthcheckPath: service.healthcheckPath,
        memoryMb: service.memoryMb,
      },
      variables: failure.variables,
      envExample: needsExample ? await envExampleAt(deps, owner, service, row.commitSha) : {},
    };
    const refused = changes.flatMap((change) => {
      const verdict = allowedChange(change, facts);
      return verdict.ok ? [] : [`${describeChange(change, false)}: ${verdict.reason}`];
    });
    if (refused.length > 0) {
      throw problem(
        "validation_failed",
        `Autofix may not make these changes: ${refused.join("; ")}.`,
      );
    }
  }
  const secretBox = changes.some((change) => change.kind === "variable")
    ? requireSecretBox(deps.secretBox)
    : null;

  const written = await db.transaction(async (tx) => {
    const events: EventRow[] = [];
    const items: DiagnosisAction[] = [];
    let sessionId = chain.sessionId;
    if (!sessionId) {
      sessionId = newId("ags");
      await tx.insert(schema.agentSessions).values({
        id: sessionId,
        projectId: row.projectId,
        userId: failure.ownerId,
        kind: "autofix",
      });
    }
    const addAction = async (input: {
      tool: string;
      args: Record<string, unknown>;
      proposed: boolean;
    }): Promise<ActionRow> => {
      const [action] = await tx
        .insert(actionsTable)
        .values({
          id: newId("act"),
          sessionId,
          projectId: row.projectId,
          kind: "autofix",
          tool: input.tool,
          args: input.args,
          status: input.proposed ? "proposed" : "completed",
          requiresApproval: input.proposed,
          result: null,
        })
        .returning();
      if (!action) throw new Error("insert returned no action");
      events.push(
        await recordEvent(tx, {
          projectId: row.projectId,
          actorType: "agent",
          actorId: action.id,
          type: input.proposed ? "agent.action_proposed" : "agent.action_completed",
          data: toAgentAction(action),
        }),
      );
      return action;
    };

    const settings = changes.flatMap((change) => (change.kind === "setting" ? [change] : []));
    if (settings.length > 0) {
      const patch = Object.fromEntries(
        settings.map((change) => [
          change.setting,
          change.setting === "healthcheckPath" ? change.value : Number(change.value),
        ]),
      );
      const action = await addAction({
        tool: "update_service_settings",
        args: { serviceId: service.id, settings: patch },
        proposed: false,
      });
      const [updated] = await tx
        .update(schema.services)
        .set(patch)
        .where(eq(schema.services.id, service.id))
        .returning();
      if (!updated) throw new Error("update returned no service");
      events.push(
        await recordEvent(tx, {
          projectId: row.projectId,
          actorType: "agent",
          actorId: action.id,
          type: "service.updated",
          data: toService(updated, deps.appsDomain),
        }),
      );
      for (const change of settings) {
        items.push({
          id: action.id,
          tool: action.tool,
          summary: describeChange(change, true),
          status: "completed",
          deploymentId: null,
        });
      }
    }

    const variables = changes.flatMap((change) => (change.kind === "variable" ? [change] : []));
    if (variables.length > 0 && secretBox) {
      const keys = variables.map((change) => change.key);
      const action = await addAction({
        tool: "set_variables",
        args: { serviceId: service.id, keys },
        proposed: false,
      });
      for (const change of variables) {
        await setAgentVariable(tx, secretBox, service.id, change.key, change.value);
        items.push({
          id: action.id,
          tool: action.tool,
          summary: describeChange(change, true),
          status: "completed",
          deploymentId: null,
        });
      }
      events.push(
        await recordEvent(tx, {
          projectId: row.projectId,
          actorType: "agent",
          actorId: action.id,
          type: "variables.changed",
          data: { serviceId: service.id, keys: [...keys].sort() },
        }),
      );
    }

    for (const proposal of proposals) {
      const action = await addAction(
        proposal.kind === "setting"
          ? {
              tool: "update_service_settings",
              args: { serviceId: service.id, settings: { [proposal.setting]: proposal.value } },
              proposed: true,
            }
          : {
              tool: "set_variables",
              args: { serviceId: service.id, keys: [proposal.key] },
              proposed: true,
            },
      );
      items.push({
        id: action.id,
        tool: action.tool,
        summary: describeChange(proposal, false),
        status: "proposed",
        deploymentId: null,
      });
    }

    const deployAction =
      changes.length > 0
        ? await addAction({
            tool: "deploy",
            args: { serviceId: service.id, fromDeploymentId: row.id, commitSha: row.commitSha },
            proposed: false,
          })
        : null;
    const status = changes.length > 0 ? "fixed" : proposals.length > 0 ? "proposed" : "needs_human";
    const [diagnosis] = await tx
      .insert(diagnoses)
      .values({
        id: newId("dgn"),
        deploymentId: row.id,
        category: body.category,
        summary: body.summary,
        evidence: body.evidence,
        actions: items,
        attempt: chain.attempt,
        status,
      })
      .returning();
    if (!diagnosis) throw new Error("insert returned no diagnosis");
    return { diagnosis, items, events, deployAction };
  });
  await publishEvents(deps.redis, written.events, deps.log);

  let { diagnosis } = written;
  const { deployAction } = written;
  if (deployAction) {
    const [fresh] = await db
      .select()
      .from(schema.services)
      .where(eq(schema.services.id, service.id))
      .limit(1);
    try {
      const started = await startDeployment(deps, {
        service: fresh ?? service,
        trigger: "agent",
        commit: { sha: row.commitSha, message: row.commitMessage, author: row.commitAuthor },
        actor: { type: "agent", id: deployAction.id },
        createdByActionId: deployAction.id,
      });
      if (started) {
        const item: DiagnosisAction = {
          id: deployAction.id,
          tool: "deploy",
          summary: `Redeployed ${row.commitSha.slice(0, 7)}`,
          status: "completed",
          deploymentId: started.id,
        };
        await db
          .update(actionsTable)
          .set({ result: { deploymentId: started.id } })
          .where(eq(actionsTable.id, deployAction.id));
        const [updated] = await db
          .update(diagnoses)
          .set({ actions: [...written.items, item] })
          .where(eq(diagnoses.id, diagnosis.id))
          .returning();
        if (updated) diagnosis = updated;
      }
    } catch (error) {
      // The changes stay; the user can deploy them. startDeployment already failed the deployment.
      deps.log.error({ err: error, deploymentId: row.id }, "autofix couldn't start the redeploy");
    }
  }

  const result = toDiagnosis(diagnosis);
  const event = await recordEvent(db, {
    projectId: row.projectId,
    actorType: "agent",
    actorId: deployAction?.id ?? null,
    type: "diagnosis.created",
    data: result,
  });
  await publishEvents(deps.redis, [event], deps.log);
  deps.log.info(
    {
      deploymentId: row.id,
      category: result.category,
      status: result.status,
      attempt: result.attempt,
    },
    "diagnosis written",
  );
  return result;
}
