import { API_BASE_PATH } from "@lift/shared";
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
];

export const server = setupServer(...handlers);
