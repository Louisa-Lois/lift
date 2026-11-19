import { problem } from "./problem";

/**
 * A cursor that is a whole number: a GitHub page, or an offset into a short list (projects,
 * search results). Clients pass back the `nextCursor` they got; anything else is their mistake.
 */
export function numberCursor(cursor: string | undefined, fallback: number): number {
  if (cursor === undefined) return fallback;
  const value = Number(cursor);
  if (!Number.isInteger(value) || value < 0) {
    throw problem("validation_failed", "That cursor didn't come from this list.", {
      fields: { cursor: "Use the nextCursor of the previous page" },
    });
  }
  return value;
}
