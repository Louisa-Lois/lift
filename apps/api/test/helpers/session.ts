import { API_BASE_PATH, SESSION_COOKIE } from "@lift/shared";
import { type buildTestApp, TEST_AGENT_TOKEN } from "./app";

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/**
 * Signs in through the real routes (start, then the callback with the state GitHub would send
 * back) and returns the session cookie. The app's GitHub fetch decides who signs in.
 */
export async function signIn(app: TestApp): Promise<string> {
  const start = await app.inject({ method: "GET", url: `${API_BASE_PATH}/auth/github/start` });
  const state = new URL(String(start.headers.location)).searchParams.get("state") ?? "";
  const oauth = start.cookies.find((cookie) => cookie.name === "lift_oauth")?.value ?? "";
  const callback = await app.inject({
    method: "GET",
    url: `${API_BASE_PATH}/auth/github/callback?code=test-code&state=${state}`,
    cookies: { lift_oauth: oauth },
  });
  const session = callback.cookies.find((cookie) => cookie.name === SESSION_COOKIE)?.value;
  if (!session) throw new Error(`sign-in failed: ${callback.headers.location}`);
  return session;
}

/** Inject options for a signed-in request. */
export const as = (session: string) => ({ cookies: { [SESSION_COOKIE]: session } });

/** Inject options for the agent service acting as a user, as it calls the API from inside. */
export const asAgent = (userId: string, token = TEST_AGENT_TOKEN) => ({
  headers: { authorization: `Bearer ${token}`, "x-lift-act-as": userId },
});
