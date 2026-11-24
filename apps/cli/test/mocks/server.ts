import { API_BASE_PATH, rollbackTarget } from "@lift/shared";
import * as fx from "@lift/shared/fixtures";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

export const DEFAULT_MOCK_API = "http://localhost:3000";
const api = (path: string) => `${DEFAULT_MOCK_API}${API_BASE_PATH}${path}`;

export const handlers = [
  // Health
  http.get(api("/health"), () => {
    return HttpResponse.json({ status: "ok" });
  }),

  // Current user
  http.get(api("/me"), ({ request }) => {
    const auth = request.headers.get("authorization");
    if (!auth?.startsWith("Bearer ")) {
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Unauthenticated",
          status: 401,
          detail: "Not signed in",
          code: "unauthenticated",
        },
        { status: 401, headers: { "content-type": "application/problem+json" } },
      );
    }
    const token = auth.replace("Bearer ", "");
    if (token === "invalid_token") {
      return HttpResponse.json(
        {
          type: "about:blank",
          title: "Unauthenticated",
          status: 401,
          detail: "Token expired or revoked",
          code: "unauthenticated",
        },
        { status: 401, headers: { "content-type": "application/problem+json" } },
      );
    }
    return HttpResponse.json(fx.me);
  }),

  // Logout
  http.post(api("/auth/logout"), () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Projects list
  http.get(api("/projects"), () => {
    return HttpResponse.json(fx.page([fx.projectListItem]));
  }),

  // Project detail
  http.get(api(`/projects/${fx.fixtureIds.project}`), () => {
    return HttpResponse.json(fx.project);
  }),

  // Services list for demo project
  http.get(api(`/projects/${fx.fixtureIds.project}/services`), () => {
    return HttpResponse.json(fx.page([fx.services.web, fx.services.api]));
  }),

  // Single service
  http.get(api(`/services/${fx.fixtureIds.services.web}`), () => {
    return HttpResponse.json(fx.services.web);
  }),
  http.get(api(`/services/${fx.fixtureIds.services.api}`), () => {
    return HttpResponse.json(fx.services.api);
  }),

  // Deployments
  http.get(api("/services/:serviceId/deployments"), () => {
    return HttpResponse.json(fx.page(fx.deployments.web));
  }),
  http.post(api("/services/:serviceId/deployments"), async ({ request }) => {
    try {
      const body = (await request.json()) as { commitSha?: string };
      if (body?.commitSha === "fail_sha") {
        const failedDep = fx.deployments.web.find((d) => d.status === "failed");
        return HttpResponse.json(failedDep || fx.deployments.web[0], { status: 202 });
      }
    } catch {
      // Ignore body parsing error
    }
    const activeDep = fx.deployments.web.find((d) => d.status === "active");
    return HttpResponse.json(activeDep || fx.deployments.web[0], { status: 202 });
  }),
  http.get(api("/deployments/:id"), ({ params }) => {
    const id = String(params.id);
    const detail =
      fx.deploymentDetails[id] ||
      fx.deploymentDetails[fx.fixtureIds.deployments.webActive] ||
      Object.values(fx.deploymentDetails)[0];
    return HttpResponse.json(detail);
  }),
  http.get(api("/deployments/:id/logs"), ({ params }) => {
    const id = String(params.id);
    const lines = fx.deploymentLogs[id] || fx.buildLog;
    return HttpResponse.json({ data: lines });
  }),
  http.get(api("/deployments/:id/logs/stream"), ({ params }) => {
    const id = String(params.id);
    const line = (fx.deploymentLogs[id] || fx.buildLog)[0];
    const streamText = `event: log\ndata: ${JSON.stringify(line)}\n\nevent: end\ndata: {"status":"active"}\n\n`;
    return new HttpResponse(streamText, {
      headers: { "content-type": "text/event-stream" },
    });
  }),
  http.post(api("/deployments/:id/rollback"), ({ params }) => {
    const id = String(params.id);
    const target = fx.allDeployments.find((d) => d.id === id);
    if (target) {
      const serviceDeployments = fx.allDeployments.filter((d) => d.serviceId === target.serviceId);
      const check = rollbackTarget(target, serviceDeployments);
      if (!check.ok) {
        return HttpResponse.json(
          {
            type: "about:blank",
            title: "Conflict",
            status: 409,
            detail: check.reason,
            code: "conflict",
          },
          { status: 409, headers: { "content-type": "application/problem+json" } },
        );
      }
    }
    return HttpResponse.json(fx.deployments.web[0], { status: 202 });
  }),

  // Service restart
  http.post(api("/services/:id/restart"), () => {
    return HttpResponse.json(fx.services.web, { status: 202 });
  }),

  // Variables
  http.get(api("/services/:serviceId/variables"), ({ request }) => {
    const url = new URL(request.url);
    const reveal = url.searchParams.get("reveal") === "true";
    return HttpResponse.json(fx.page(reveal ? fx.revealedVariables.web : fx.variables.web));
  }),
  http.put(api("/services/:serviceId/variables"), () => {
    return HttpResponse.json({
      variables: fx.variables.web,
      requiresRedeploy: true,
    });
  }),

  // Databases
  http.get(api("/projects/:projectId/databases"), () => {
    return HttpResponse.json(fx.page([fx.database]));
  }),
  http.post(api("/projects/:projectId/databases"), () => {
    return HttpResponse.json(fx.database, { status: 202 });
  }),
];

export const server = setupServer(...handlers);
