import { childEnv, type RunResult, run } from "../process";

/** `railpack build` with plain progress, so every BuildKit step is a readable line. */
export function railpackArgs(
  dir: string,
  imageTag: string,
  buildVariables: Record<string, string>,
): string[] {
  // Users' build-time variables arrive with BE-09; they will need a way in other than argv.
  const env = Object.entries(buildVariables).flatMap(([key, value]) => [
    "--env",
    `${key}=${value}`,
  ]);
  return ["build", dir, "--name", imageTag, "--progress", "plain", ...env];
}

export interface ImageBuildInput {
  dir: string;
  imageTag: string;
  buildVariables: Record<string, string>;
  buildkitHost: string;
  timeoutMs: number;
  onLine: (line: string) => void;
}

/**
 * Builds the image through BuildKit. Railpack hands it to Docker with `docker load` itself (spike
 * S1), which is why the worker needs the Docker CLI: without it Railpack hangs, and the timeout
 * is what ends it.
 */
export function railpackBuild(input: ImageBuildInput): Promise<RunResult> {
  return run("railpack", railpackArgs(input.dir, input.imageTag, input.buildVariables), {
    env: childEnv({ BUILDKIT_HOST: input.buildkitHost }),
    timeoutMs: input.timeoutMs,
    onLine: input.onLine,
  });
}

/** Whether Docker has the image (what `docker load` should have left behind). */
export async function imageExists(imageTag: string): Promise<boolean> {
  const result = await run("docker", ["image", "inspect", "--format", "{{.Id}}", imageTag], {
    env: childEnv(),
    timeoutMs: 30_000,
  });
  return result.code === 0;
}
