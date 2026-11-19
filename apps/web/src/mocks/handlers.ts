import { API_BASE_PATH } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { HttpResponse, http } from "msw";

const api = (path: string) => `${API_BASE_PATH}${path}`;

/**
 * Mock API answers built from @lift/shared/fixtures, so screens work before their routes exist.
 * Each screen's task adds the handlers it needs; requests without one go to the real API.
 */
export const handlers = [
  http.get(api("/health"), () => HttpResponse.json({ status: "ok" })),
  http.get(api("/me"), () => HttpResponse.json(fixtures.me)),
];
