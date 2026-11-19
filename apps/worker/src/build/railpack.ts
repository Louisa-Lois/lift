import { childEnv, type RunResult, run } from "../process";

/**
 * Variables the build tools themselves read. Passing one to Railpack's environment would steer
 * Railpack, git or Docker rather than the app's build, so these stay out of it (the app still gets
 * them when it runs).
 */
const TOOL_VARIABLE =
  /^(?:PATH|HOME|TMPDIR|LANG|LC_ALL|SSL_CERT_FILE|SSL_CERT_DIR|(?:HTTP|HTTPS|NO|ALL)_PROXY|DOCKER_\w*|BUILDKIT_\w*|LD_\w*)$/i;

/** Splits a service's build variables into those Railpack gets and those the tools keep. */
export function splitBuildVariables(variables: Record<string, string>): {
  passed: Record<string, string>;
  skipped: string[];
} {
  const passed: Record<string, string> = {};
  const skipped: string[] = [];
  for (const [key, value] of Object.entries(variables)) {
    if (TOOL_VARIABLE.test(key)) skipped.push(key);
    else passed[key] = value;
  }
  return { passed, skipped: skipped.sort() };
}

/**
 * The service's own build and start commands, as the settings Railpack reads to override what it
 * detects: `RAILPACK_BUILD_CMD` and `RAILPACK_START_CMD` (`GetConfigVariable("BUILD_CMD")` and
 * `("START_CMD")` in v0.43.0). They travel like variables; a setting wins over a variable of the
 * same name, and an unset one leaves Railpack's choice alone.
 */
export function commandVariables(service: {
  buildCommand: string | null;
  startCommand: string | null;
}): Record<string, string> {
  const commands: Record<string, string> = {};
  if (service.buildCommand) commands.RAILPACK_BUILD_CMD = service.buildCommand;
  if (service.startCommand) commands.RAILPACK_START_CMD = service.startCommand;
  return commands;
}

/**
 * `railpack build` with plain progress, so every BuildKit step is a readable line. Variables go
 * in by name only (`--env KEY`): Railpack reads a bare name's value from its own environment, so
 * no value is ever in argv, where `ps` and error messages could show it.
 */
export function railpackArgs(
  dir: string,
  imageTag: string,
  variableKeys: readonly string[],
): string[] {
  const env = variableKeys.flatMap((key) => ["--env", key]);
  return ["build", dir, "--name", imageTag, "--progress", "plain", ...env];
}

export interface ImageBuildInput {
  dir: string;
  imageTag: string;
  buildVariables: Record<string, string>;
  buildkitHost: string;
  timeoutMs: number;
  onLine: (line: string) => void;
  /** Stops Railpack, and with it the BuildKit solve, when the deployment is canceled. */
  signal?: AbortSignal;
}

/**
 * Builds the image through BuildKit. Railpack hands it to Docker with `docker load` itself (spike
 * S1), which is why the worker needs the Docker CLI: without it Railpack hangs, and the timeout
 * is what ends it.
 */
export function railpackBuild(input: ImageBuildInput): Promise<RunResult> {
  const { passed } = splitBuildVariables(input.buildVariables);
  return run("railpack", railpackArgs(input.dir, input.imageTag, Object.keys(passed)), {
    env: childEnv({ ...passed, BUILDKIT_HOST: input.buildkitHost }),
    timeoutMs: input.timeoutMs,
    onLine: input.onLine,
    signal: input.signal,
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
