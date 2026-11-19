import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { type Db, schema } from "@lift/db";
import { API_BASE_PATH } from "@lift/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { SecretBox } from "./crypto";
import { type DeploymentDeps, startDeployment } from "./deployments";
import type { Github } from "./github";
import type { ServiceRow } from "./services";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Whether GitHub can deliver to this API: not when it runs on localhost (GitHub refuses those). */
export function canReceiveWebhooks(publicUrl: string): boolean {
  const host = new URL(publicUrl).hostname.toLowerCase();
  return !LOOPBACK.has(host) && !host.endsWith(".localhost");
}

/** Where a service's push events go: `{PUBLIC_URL}/api/v1/webhooks/github?service={id}`. */
export function webhookUrl(publicUrl: string, serviceId: string): string {
  return `${publicUrl.replace(/\/+$/, "")}${API_BASE_PATH}/webhooks/github?service=${serviceId}`;
}

export interface WebhookDeps {
  db: Db;
  github: Github;
  secretBox: SecretBox | null;
  publicUrl: string;
  log: FastifyBaseLogger;
}

/**
 * Gives a service its push webhook if it has none (docs/prd/01-backend-api.md, "Creating a
 * service"): GitHub signs each delivery with a random secret of the service's own, stored
 * encrypted. Called when a service is created and before each manual deploy, so services made
 * before webhooks existed get theirs too. Best effort: a user without admin rights on the repo,
 * or a server GitHub can't reach, leaves the service without one (manual deploys still work),
 * and nothing here ever fails the request that called it.
 */
export async function ensureWebhook(
  deps: WebhookDeps,
  service: ServiceRow,
  token: string,
): Promise<void> {
  const { db, github, secretBox, publicUrl, log } = deps;
  if (service.webhookId !== null || !secretBox || !canReceiveWebhooks(publicUrl)) return;
  const { repoOwner: owner, repoName: name } = service;
  try {
    const secret = randomBytes(32).toString("hex");
    const hookId = await github.createHook(token, owner, name, {
      url: webhookUrl(publicUrl, service.id),
      secret,
    });
    if (hookId === null) {
      log.info({ serviceId: service.id }, "no rights to add a push webhook; manual deploys only");
      return;
    }
    const [stored] = await db
      .update(schema.services)
      .set({ webhookId: hookId, webhookSecretEnc: secretBox.encrypt(secret) })
      .where(and(eq(schema.services.id, service.id), isNull(schema.services.webhookId)))
      .returning({ id: schema.services.id });
    // Another request gave the service its webhook first: keep that one, drop this one.
    if (!stored) await github.deleteHook(token, owner, name, hookId);
  } catch (error) {
    log.warn({ err: error, serviceId: service.id }, "couldn't add the push webhook");
  }
}

/** Removes a deleted service's webhook from GitHub; best effort, like adding it. */
export async function removeWebhook(
  deps: WebhookDeps,
  service: ServiceRow,
  token: string,
): Promise<void> {
  if (service.webhookId === null) return;
  try {
    await deps.github.deleteHook(token, service.repoOwner, service.repoName, service.webhookId);
  } catch (error) {
    deps.log.warn({ err: error, serviceId: service.id }, "couldn't remove the push webhook");
  }
}

/** Checks `X-Hub-Signature-256` (`sha256=` and the hex HMAC of the raw body) in constant time. */
export function signatureMatches(
  secret: string,
  body: Buffer,
  header: string | string[] | undefined,
): boolean {
  if (typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", secret).update(body).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The parts of GitHub's push payload Lift reads. */
export interface PushEvent {
  ref?: string;
  after?: string;
  deleted?: boolean;
  repository?: { full_name?: string };
  head_commit?: {
    message?: string;
    author?: { name?: string; username?: string };
  } | null;
}

export interface PushOutcome {
  deploymentId: string | null;
  /** For GitHub's delivery log: what Lift did with the push, in words. */
  message: string;
}

/**
 * A verified push (docs/prd/01-backend-api.md, "Deployments"): a push to the service's branch
 * deploys its head commit with `trigger: push`; other branches, branch deletions and other repos
 * are ignored, and a commit already deployed from a push or the editor isn't deployed again.
 */
export async function deployPush(
  deps: DeploymentDeps,
  service: ServiceRow,
  push: PushEvent,
): Promise<PushOutcome> {
  const ignored = (why: string) => ({ deploymentId: null, message: `Ignored: ${why}.` });
  const repo = `${service.repoOwner}/${service.repoName}`;
  if (
    push.repository?.full_name &&
    push.repository.full_name.toLowerCase() !== repo.toLowerCase()
  ) {
    return ignored(`the push is for ${push.repository.full_name}, not ${repo}`);
  }
  if (push.ref !== `refs/heads/${service.branch}`) {
    return ignored(
      `a push to ${push.ref ?? "an unknown ref"}; this service deploys ${service.branch}`,
    );
  }
  const sha = push.after ?? "";
  if (push.deleted || !/^[0-9a-f]{40}$/.test(sha) || /^0{40}$/.test(sha)) {
    return ignored("the push deleted the branch, or names no commit");
  }
  const subject = push.head_commit?.message?.split("\n", 1)[0]?.trim().slice(0, 500);
  const row = await startDeployment(deps, {
    service,
    trigger: "push",
    commit: {
      sha,
      message: subject || null,
      author: push.head_commit?.author?.username ?? push.head_commit?.author?.name ?? null,
    },
    actor: { type: "system", id: null },
  });
  if (!row)
    return ignored(`commit ${sha.slice(0, 7)} was already deployed from a push or the editor`);
  return { deploymentId: row.id, message: `Queued deployment ${row.id} of ${sha.slice(0, 7)}.` };
}
