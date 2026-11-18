// ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
// │ STUB: AI-00 (Lyse) fills this in. Fields come from docs/contracts.md ("AgentSession,         │
// │ AgentAction") and docs/prd/03-ai-agent.md ("Ops chat"). Whatever the docs leave open is      │
// │ z.string() or z.unknown() on purpose: AI-00 decides it, and nothing should rely on it yet.   │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
import { z } from "zod";
import { AgentSessionKind, type ChatEventType } from "../enums";
import { AgentActionId, AgentSessionId, ProjectId, UserId } from "../ids";
import { Timestamp } from "./common";

/** One conversation or job: one chat session per project per user, or one autofix chain. */
export const AgentSession = z.object({
  id: AgentSessionId,
  /** Null for onboarding, which happens before the project exists. */
  projectId: ProjectId.nullable(),
  userId: UserId,
  kind: AgentSessionKind,
  createdAt: Timestamp,
});
export type AgentSession = z.infer<typeof AgentSession>;

/**
 * Something the agent did or proposes to do: one tool call. Writes that need approval start as
 * `proposed` (the only status the docs name; AI-00 lists the rest).
 */
export const AgentAction = z.object({
  id: AgentActionId,
  sessionId: AgentSessionId.nullable(),
  projectId: ProjectId.nullable(),
  kind: AgentSessionKind,
  tool: z.string().min(1),
  args: z.unknown(),
  status: z.string().min(1),
  requiresApproval: z.boolean(),
  result: z.unknown(),
  createdAt: Timestamp,
});
export type AgentAction = z.infer<typeof AgentAction>;

/** `POST /projects/:id/agent/messages` → an SSE stream of the assistant's reply. */
export const SendAgentMessageBody = z.strictObject({
  sessionId: AgentSessionId.optional(),
  text: z.string().trim().min(1).max(4000),
});
export type SendAgentMessageBody = z.infer<typeof SendAgentMessageBody>;

/** The chat reply stream: SSE event name → data. Payloads 03 doesn't define are left open. */
export const CHAT_STREAM_EVENTS = {
  text_delta: z.unknown(),
  tool_call: z.object({ tool: z.string(), summary: z.string(), status: z.string() }),
  approval_required: z.object({
    actionId: AgentActionId,
    summary: z.string(),
    diff: z.string().optional(),
  }),
  tool_result: z.unknown(),
  done: z.unknown(),
} as const satisfies Record<ChatEventType, z.ZodType>;
