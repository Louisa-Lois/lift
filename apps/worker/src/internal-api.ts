import {
  type BuildContext,
  type DeploymentStatusReport,
  type DeploymentStatusReportResponse,
  INTERNAL_BASE_PATH,
  INTERNAL_ROUTES,
  type RuntimeEnv,
} from "@lift/shared";
import type { z } from "zod";

/**
 * The API answered 409: the deployment moved on without us (canceled, superseded, or failed by
 * the backstop). The job stops quietly; it is not an error.
 */
export class StopDeployment extends Error {
  override readonly name = "StopDeployment";
}

export interface InternalApiOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  /** Waits before each retry of a 5xx or a network error; the default is 1 s, 2 s, then 5 s. */
  retryDelaysMs?: number[];
}

type Route = (typeof INTERNAL_ROUTES)[keyof typeof INTERNAL_ROUTES];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function problemDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string; title?: string };
    return body.detail ?? body.title ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

/** The control plane's internal routes (docs/contracts.md, "Worker jobs"), typed by INTERNAL_ROUTES. */
export function createInternalApi(options: InternalApiOptions) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const delays = options.retryDelaysMs ?? [1_000, 2_000, 5_000];

  async function call<R extends Route>(
    route: R,
    id: string,
    body?: unknown,
  ): Promise<z.infer<R["response"]>> {
    const path = route.path(id);
    const what = `${route.method} ${path}`;
    const payload = body === undefined || !("body" in route) ? undefined : route.body.parse(body);
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await fetchFn(`${options.baseUrl}${INTERNAL_BASE_PATH}${path}`, {
          method: route.method,
          headers: {
            authorization: `Bearer ${options.token}`,
            ...(payload === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        const delay = delays[attempt];
        if (delay === undefined)
          throw new Error(`${what}: the API didn't answer`, { cause: error });
        await sleep(delay);
        continue;
      }
      if (response.status === 409) throw new StopDeployment(await problemDetail(response));
      if (response.status >= 500 && delays[attempt] !== undefined) {
        await sleep(delays[attempt] as number);
        continue;
      }
      if (!response.ok) {
        throw new Error(`${what} answered ${response.status}: ${await problemDetail(response)}`);
      }
      return route.response.parse(await response.json()) as z.infer<R["response"]>;
    }
  }

  return {
    buildContext: (deploymentId: string): Promise<BuildContext> =>
      call(INTERNAL_ROUTES.buildContext, deploymentId),
    runtimeEnv: (deploymentId: string): Promise<RuntimeEnv> =>
      call(INTERNAL_ROUTES.runtimeEnv, deploymentId),
    reportStatus: (
      deploymentId: string,
      report: DeploymentStatusReport,
    ): Promise<DeploymentStatusReportResponse> =>
      call(INTERNAL_ROUTES.deploymentStatus, deploymentId, report),
  };
}

export type InternalApi = ReturnType<typeof createInternalApi>;
