/**
 * The constraint a unique violation (Postgres 23505) hit, or null for any other error. Drizzle
 * wraps the driver's error, so look at its cause too.
 */
export function uniqueViolation(error: unknown): string | null {
  for (let current = error; current; current = (current as { cause?: unknown }).cause) {
    const { code, constraint_name } = current as { code?: string; constraint_name?: string };
    if (code === "23505") return constraint_name ?? "";
    if (current === (current as { cause?: unknown }).cause) break;
  }
  return null;
}
