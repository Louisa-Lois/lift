import { API_BASE_PATH, createLiftClient } from "@lift/shared";

/**
 * The one client for the Lift API, typed by packages/shared. The browser signs its requests with
 * the lift_session cookie, so no token is needed. In development /api goes through Next's proxy
 * to port 4000; in production Traefik routes it to the API container.
 */
export const api = createLiftClient({ baseUrl: API_BASE_PATH });
