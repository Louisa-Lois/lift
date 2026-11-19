import {
  AutofixContext,
  type CreateDiagnosisBody,
  codeForStatus,
  Diagnosis,
  INTERNAL_BASE_PATH,
  INTERNAL_ROUTES,
  LiftApiError,
  Problem,
} from "@lift/shared";

/** The API's internal routes for autofix, with AGENT_SERVICE_TOKEN (never through Traefik). */
export interface AutofixApi {
  context(deploymentId: string): Promise<AutofixContext>;
  diagnose(body: CreateDiagnosisBody): Promise<Diagnosis>;
}

export function autofixApi(options: {
  apiUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}): AutofixApi {
  const fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const base = `${options.apiUrl.replace(/\/+$/, "")}${INTERNAL_BASE_PATH}`;

  async function send(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetchFn(`${base}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const problem = Problem.safeParse(json);
      throw new LiftApiError(
        problem.success
          ? problem.data
          : {
              type: "about:blank",
              title: "Error",
              status: response.status,
              detail: `The API answered ${response.status}.`,
              code: codeForStatus(response.status),
            },
      );
    }
    return json;
  }

  return {
    async context(deploymentId) {
      const route = INTERNAL_ROUTES.autofixContext;
      return AutofixContext.parse(await send(route.method, route.path(deploymentId)));
    },
    async diagnose(body) {
      const route = INTERNAL_ROUTES.diagnoses;
      return Diagnosis.parse(await send(route.method, route.path(), body));
    },
  };
}
