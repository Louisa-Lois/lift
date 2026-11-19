/** Waits before each reconnect: 1, 2 and 5 seconds, then every 10 seconds for as long as it takes. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 10_000;
}

/** Resolves after `ms`, or at once when `signal` aborts. */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
