import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

const globalForMocks = globalThis as typeof globalThis & { __liftMocks?: Promise<void> };

/**
 * Starts Mock Service Worker in the browser (public/mockServiceWorker.js). Only loaded when
 * NEXT_PUBLIC_USE_MOCKS=1; requests without a handler pass through to the real API.
 *
 * Starts once per page: React runs effects twice in development, and hot reloads re-run this
 * module, but MSW can patch the browser's globals (fetch, WebSocket) only once.
 */
export function startMocks(): Promise<void> {
  globalForMocks.__liftMocks ??= setupWorker(...handlers)
    .start({ onUnhandledFrame: "bypass", quiet: true })
    .then(() => undefined);
  return globalForMocks.__liftMocks;
}
