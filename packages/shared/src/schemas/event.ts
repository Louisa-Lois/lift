import { z } from "zod";
import {
  ActorType,
  DatabaseStatus,
  DeploymentStatus,
  PROJECT_EVENT_TYPES,
  type ProjectEventType,
  ProjectRole,
} from "../enums";
import { EventId, ProjectId, ServiceId } from "../ids";
import { AgentAction } from "./agent";
import { ListQuery, Timestamp, VariableKey } from "./common";
import { Database } from "./database";
import { Deployment } from "./deployment";
import { EditorCommit } from "./editor";
import { ProjectMember } from "./member";
import { ProjectBase } from "./project";
import { Service } from "./service";

const eventFields = {
  id: EventId,
  projectId: ProjectId,
  actorType: ActorType,
  /** `usr_…` when a user acted; otherwise whatever identifies the actor (an `act_…` for the agent), or null. */
  actorId: z.string().nullable(),
  createdAt: Timestamp,
};

function eventOf<T extends ProjectEventType, D extends z.ZodType>(type: T, data: D) {
  return z.object({ ...eventFields, type: z.literal(type), data });
}

/** A deployment that changed status, with the status it left. */
export const DeploymentStatusChange = Deployment.extend({ previousStatus: DeploymentStatus });
/** A database that changed status; `previousStatus` is null when it was just created. */
export const DatabaseStatusChange = Database.extend({ previousStatus: DatabaseStatus.nullable() });
/** Keys only: events are stored, so values never go in them. */
export const VariablesChange = z.object({
  serviceId: ServiceId,
  keys: z.array(VariableKey).min(1),
});
/** A member added (`previousRole: null`), changed, or removed (`removed: true`). */
export const MemberChange = ProjectMember.extend({
  previousRole: ProjectRole.nullable(),
  removed: z.boolean(),
});

/**
 * An `events` row: the audit log, `GET /projects/:id/events`, and every message on the project
 * stream (whose SSE `event:` name is the `type`). `data` is the changed resource as it is after
 * the change; deletions carry the resource as it was.
 */
export const ProjectEvent = z.discriminatedUnion("type", [
  eventOf("deployment.created", Deployment),
  eventOf("deployment.status_changed", DeploymentStatusChange),
  eventOf("service.created", Service),
  eventOf("service.updated", Service),
  eventOf("service.deleted", Service),
  eventOf("service.restarted", Service),
  eventOf("database.status_changed", DatabaseStatusChange),
  eventOf("variables.changed", VariablesChange),
  eventOf("project.updated", ProjectBase),
  eventOf("project.deleted", ProjectBase),
  eventOf("member.changed", MemberChange),
  eventOf("agent.action_proposed", AgentAction),
  eventOf("agent.action_completed", AgentAction),
  eventOf("editor.committed", EditorCommit),
]);
export type ProjectEvent = z.infer<typeof ProjectEvent>;
export type ProjectEventOf<T extends ProjectEventType> = Extract<ProjectEvent, { type: T }>;

const knownTypes = new Set<string>(PROJECT_EVENT_TYPES);

/** An event of a type this version doesn't know yet. Clients skip these. */
export const UnknownProjectEvent = z.object({
  ...eventFields,
  type: z.string().refine((type) => !knownTypes.has(type), "This event type is known"),
  data: z.unknown(),
});
export type UnknownProjectEvent = z.infer<typeof UnknownProjectEvent>;

/**
 * What the events routes may send: a known event, or one from a newer API that this client
 * skips. A known type with the wrong payload still fails, so drift shows up in tests.
 */
export const AnyProjectEvent = z.union([ProjectEvent, UnknownProjectEvent]);
export type AnyProjectEvent = z.infer<typeof AnyProjectEvent>;

export function isKnownProjectEvent(event: AnyProjectEvent): event is ProjectEvent {
  return knownTypes.has(event.type);
}

/** `GET /projects/:id/events?cursor=`, newest first. */
export const ProjectEventsQuery = ListQuery;
export type ProjectEventsQuery = z.infer<typeof ProjectEventsQuery>;
