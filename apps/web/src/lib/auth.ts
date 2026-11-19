import { INVITE_ONLY_PROBLEM_TYPE, RedirectPath } from "@lift/shared";

/** `next` if it's a path on this site (never `//evil.example`), otherwise undefined. */
export function safeNext(next: string | null | undefined): string | undefined {
  if (!next) return undefined;
  return RedirectPath.safeParse(next).success ? next : undefined;
}

/**
 * Where a signed-out visitor goes: /login, coming back to `next` afterwards. A 401 whose problem
 * type is invite-only (the login was removed from the list) also shows that message.
 */
export function loginUrl(next: string, problemType?: string): string {
  const params = new URLSearchParams();
  const path = safeNext(next);
  if (path && path !== "/login") params.set("next", path);
  if (problemType === INVITE_ONLY_PROBLEM_TYPE) params.set("error", "invite_only");
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}
