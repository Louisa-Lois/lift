import { type Db, schema } from "@lift/db";
import { type ActorType, newId, type ProjectEventType, REDIS_STREAMS } from "@lift/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";

/** The database or an open transaction: both run the same queries. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export type EventRow = typeof schema.events.$inferSelect;

export interface EventInput {
  projectId: string;
  actorType: ActorType;
  actorId: string | null;
  type: ProjectEventType;
  /** The changed resource, as the API returns it. */
  data: unknown;
}

/** Writes the audit row; call it inside the transaction that makes the change. */
export async function recordEvent(db: DbOrTx, input: EventInput): Promise<EventRow> {
  const [row] = await db
    .insert(schema.events)
    .values({ id: newId("evt"), ...input })
    .returning();
  if (!row) throw new Error("insert returned no event");
  return row;
}

/** The event as the project stream and `GET /projects/:id/events` send it. */
export function toEventJson(row: EventRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    actorType: row.actorType,
    actorId: row.actorId,
    type: row.type,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * After the transaction commits: appends each event to its project's Redis Stream (about 1,000
 * entries kept), where the live project stream picks it up. The row is already stored, so a Redis
 * hiccup only delays live updates; it never loses the event.
 */
export async function publishEvents(
  redis: Redis,
  rows: EventRow[],
  log: FastifyBaseLogger,
): Promise<void> {
  for (const row of rows) {
    const stream = REDIS_STREAMS.projectEvents;
    try {
      await redis.xadd(
        stream.key(row.projectId),
        "MAXLEN",
        "~",
        String(stream.maxLength),
        "*",
        "event",
        JSON.stringify(toEventJson(row)),
      );
    } catch (error) {
      log.warn({ err: error, eventId: row.id }, "couldn't publish an event to its project stream");
    }
  }
}
