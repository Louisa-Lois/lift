/**
 * The builds running in this worker process, by deployment ID, so a `stop` op (a canceled
 * deployment) can abort one. Builds and ops run in the same process; there is one worker.
 */
export function createRunningBuilds() {
  const running = new Map<string, AbortController>();
  return {
    /** Registers a build; its signal aborts when the deployment is stopped. */
    start(deploymentId: string): AbortSignal {
      const controller = new AbortController();
      running.set(deploymentId, controller);
      return controller.signal;
    },
    finish(deploymentId: string): void {
      running.delete(deploymentId);
    },
    /** Aborts the deployment's build if it runs here; false when it doesn't. */
    stop(deploymentId: string): boolean {
      const controller = running.get(deploymentId);
      if (!controller) return false;
      controller.abort();
      return true;
    },
  };
}

export type RunningBuilds = ReturnType<typeof createRunningBuilds>;
