import { ACT_AS_HEADER, API_BASE_PATH, createLiftClient } from "@lift/shared";

export type LiftApi = ReturnType<typeof createLiftClient>;

/** What the planner reads: a repo's tree and single files, through the API's GitHub routes. */
export type RepoReader = Pick<LiftApi["github"], "tree" | "contents">;

/**
 * The public API as one user (AI-02): the agent's `lift_svc_` token, with X-Lift-Act-As naming
 * the user on every request. The API lets this credential only read, as that user, so the agent
 * can never see or do more than they can, and never sees a secret.
 */
export function liftApiAs(options: {
  apiUrl: string;
  token: string;
  userId: string;
  fetch?: typeof globalThis.fetch;
}): LiftApi {
  const base = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const fetchAs: typeof globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set(ACT_AS_HEADER, options.userId);
    return base(input, { ...init, headers });
  };
  return createLiftClient({
    baseUrl: `${options.apiUrl.replace(/\/+$/, "")}${API_BASE_PATH}`,
    token: options.token,
    fetch: fetchAs,
  });
}
