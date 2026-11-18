import { z } from "zod";

/**
 * IDs are `prefix_` plus 24 lowercase letters and digits (docs/contracts.md, "IDs, names and
 * formats"), and this module is the only place they are made.
 *
 * The first fifteen prefixes come from the data model. The data model gives no prefix to five
 * tables that still need IDs, so BE-00 adds `cli` (CLI logins), `dpe` (deployment timeline
 * entries), `ecm` (editor commits), `msg` (agent messages) and `dgn` (diagnoses).
 */
export const ID_PREFIXES = {
  user: "usr",
  project: "prj",
  service: "svc",
  deployment: "dep",
  variable: "var",
  database: "db",
  domain: "dom",
  event: "evt",
  apiToken: "tok",
  onboardingPlan: "pln",
  agentSession: "ags",
  agentAction: "act",
  editorDocument: "edoc",
  evalRun: "evr",
  evalResult: "evx",
  cliLogin: "cli",
  deploymentEvent: "dpe",
  editorCommit: "ecm",
  agentMessage: "msg",
  diagnosis: "dgn",
} as const;

export type IdEntity = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdEntity];

/** Length of the random part of every ID. */
export const ID_RANDOM_LENGTH = 24;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
// 252 = 7 × 36, the largest multiple of 36 that fits in a byte. Bytes from 252 up are skipped so
// every character is equally likely; a plain `byte % 36` would favour "a" to "d".
const UNBIASED_LIMIT = 252;

/**
 * Makes a new ID, e.g. `newId("svc")` → `svc_8f3k2m9q1x7v4b6n0p5r2t8w`. Uses
 * `crypto.getRandomValues`, so it runs in Node.js and the browser alike.
 */
export function newId<P extends IdPrefix>(prefix: P): `${P}_${string}` {
  const bytes = new Uint8Array(32);
  let body = "";
  while (body.length < ID_RANDOM_LENGTH) {
    globalThis.crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= UNBIASED_LIMIT) continue;
      body += ALPHABET.charAt(byte % ALPHABET.length);
      if (body.length === ID_RANDOM_LENGTH) break;
    }
  }
  return `${prefix}_${body}`;
}

/** The pattern every ID with this prefix matches. */
export function idPattern(prefix: IdPrefix): RegExp {
  return new RegExp(`^${prefix}_[a-z0-9]{${ID_RANDOM_LENGTH}}$`);
}

/** Whether `value` is an ID with this prefix. */
export function isId(prefix: IdPrefix, value: unknown): value is string {
  return typeof value === "string" && idPattern(prefix).test(value);
}

/** A Zod schema for IDs with this prefix. */
export function idSchema(prefix: IdPrefix) {
  return z
    .string()
    .regex(idPattern(prefix), `Expected ${prefix}_ followed by 24 lowercase letters and digits`);
}

export const UserId = idSchema(ID_PREFIXES.user);
export type UserId = z.infer<typeof UserId>;
export const ProjectId = idSchema(ID_PREFIXES.project);
export type ProjectId = z.infer<typeof ProjectId>;
export const ServiceId = idSchema(ID_PREFIXES.service);
export type ServiceId = z.infer<typeof ServiceId>;
export const DeploymentId = idSchema(ID_PREFIXES.deployment);
export type DeploymentId = z.infer<typeof DeploymentId>;
export const VariableId = idSchema(ID_PREFIXES.variable);
export type VariableId = z.infer<typeof VariableId>;
export const DatabaseId = idSchema(ID_PREFIXES.database);
export type DatabaseId = z.infer<typeof DatabaseId>;
export const DomainId = idSchema(ID_PREFIXES.domain);
export type DomainId = z.infer<typeof DomainId>;
export const EventId = idSchema(ID_PREFIXES.event);
export type EventId = z.infer<typeof EventId>;
export const ApiTokenId = idSchema(ID_PREFIXES.apiToken);
export type ApiTokenId = z.infer<typeof ApiTokenId>;
export const OnboardingPlanId = idSchema(ID_PREFIXES.onboardingPlan);
export type OnboardingPlanId = z.infer<typeof OnboardingPlanId>;
export const AgentSessionId = idSchema(ID_PREFIXES.agentSession);
export type AgentSessionId = z.infer<typeof AgentSessionId>;
export const AgentActionId = idSchema(ID_PREFIXES.agentAction);
export type AgentActionId = z.infer<typeof AgentActionId>;
export const EditorDocumentId = idSchema(ID_PREFIXES.editorDocument);
export type EditorDocumentId = z.infer<typeof EditorDocumentId>;
export const EvalRunId = idSchema(ID_PREFIXES.evalRun);
export type EvalRunId = z.infer<typeof EvalRunId>;
export const EvalResultId = idSchema(ID_PREFIXES.evalResult);
export type EvalResultId = z.infer<typeof EvalResultId>;
export const CliLoginId = idSchema(ID_PREFIXES.cliLogin);
export type CliLoginId = z.infer<typeof CliLoginId>;
export const DeploymentEventId = idSchema(ID_PREFIXES.deploymentEvent);
export type DeploymentEventId = z.infer<typeof DeploymentEventId>;
export const EditorCommitId = idSchema(ID_PREFIXES.editorCommit);
export type EditorCommitId = z.infer<typeof EditorCommitId>;
export const AgentMessageId = idSchema(ID_PREFIXES.agentMessage);
export type AgentMessageId = z.infer<typeof AgentMessageId>;
export const DiagnosisId = idSchema(ID_PREFIXES.diagnosis);
export type DiagnosisId = z.infer<typeof DiagnosisId>;
