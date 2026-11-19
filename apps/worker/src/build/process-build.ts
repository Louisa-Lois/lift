import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { type BuildJob, type DeploymentErrorCode, imageTagFor } from "@lift/shared";
import { type InternalApi, StopDeployment } from "../internal-api";
import { type LogSink, variableSecrets } from "../log-sink";
import type { Logger } from "../logger";
import type { RunResult } from "../process";
import { type CloneInput, cloneCommit, tokenForms } from "./clone";
import {
  commandVariables,
  type ImageBuildInput,
  imageExists,
  railpackBuild,
  splitBuildVariables,
} from "./railpack";
import type { RunningBuilds } from "./running";

/** docs/prd/04-infrastructure.md: after 15 minutes the build is killed. */
export const BUILD_TIMEOUT_MS = 15 * 60_000;
const CLONE_TIMEOUT_MS = 5 * 60_000;

export interface BuildDeps {
  api: InternalApi;
  /** The deployment's log stream, scrubbing the given secrets from every line. */
  logSink: (deploymentId: string, secrets: string[]) => LogSink;
  buildDir: string;
  buildkitHost: string;
  log: Logger;
  /** Where a `stop` op finds this build to abort it (a canceled deployment). */
  builds?: RunningBuilds;
  timeoutMs?: number;
  // Seams for tests; by default these run git, Railpack and Docker.
  clone?: (input: CloneInput) => Promise<RunResult>;
  buildImage?: (input: ImageBuildInput) => Promise<RunResult>;
  imageExists?: (imageTag: string) => Promise<boolean>;
}

export type BuildOutcome = "deploying" | "failed" | "stopped";

/** "1.2s" under a minute, then "2m 03s", as the build log's system lines say it. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

/** spawn's error when the program isn't on PATH (see apps/worker/README.md for the tools). */
function isMissingTool(error: unknown): error is NodeJS.ErrnoException & { path: string } {
  return (
    error instanceof Error &&
    (error as NodeJS.ErrnoException).code === "ENOENT" &&
    typeof (error as NodeJS.ErrnoException).path === "string"
  );
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The build job (docs/prd/04-infrastructure.md, "Build job"): report `building`, fetch the build
 * context, clone the commit, build the image with Railpack, check Docker has it, then report
 * `deploying`, or `failed` with a code. The log is flushed before every report, so each line
 * lands before the status that ends it. A 409 from the API stops the job quietly. The clone is
 * always deleted.
 */
export async function processBuild(job: BuildJob, deps: BuildDeps): Promise<BuildOutcome> {
  const { api, log } = deps;
  const id = job.deploymentId;
  const started = Date.now();
  const at = () => new Date().toISOString();
  const dir = path.join(deps.buildDir, id);
  let logs: LogSink | null = null;

  const signal = deps.builds?.start(id);
  /** Canceled: the API already ended the deployment and its log, so nothing is reported. */
  const stopped = (): BuildOutcome => {
    log.info({ deploymentId: id }, "the build was stopped: its deployment was canceled");
    return "stopped";
  };

  const fail = async (errorCode: DeploymentErrorCode, line: string): Promise<BuildOutcome> => {
    logs?.system(line);
    await logs?.flush();
    await api.reportStatus(id, { status: "failed", errorCode, message: line, at: at() });
    return "failed";
  };

  try {
    await api.reportStatus(id, { status: "building", at: at() });
    const context = await api.buildContext(id);
    const sink = deps.logSink(id, [
      ...tokenForms(context.clone.token),
      ...variableSecrets(Object.values(context.buildVariables)),
    ]);
    logs = sink;
    const repo = `${context.repo.owner}/${context.repo.name}`;
    const short = context.commitSha.slice(0, 7);
    sink.system(`Cloning ${repo} at ${short}`);

    const cloneStarted = Date.now();
    const cloned = await (deps.clone ?? cloneCommit)({
      dir,
      owner: context.repo.owner,
      name: context.repo.name,
      sha: context.commitSha,
      token: context.clone.token,
      onLine: (line) => sink.write("build", line),
      timeoutMs: CLONE_TIMEOUT_MS,
      signal,
    });
    if (cloned.aborted) return stopped();
    if (cloned.code !== 0 || cloned.timedOut) {
      return await fail(
        "clone_failed",
        cloned.timedOut
          ? `Clone stopped after ${formatDuration(CLONE_TIMEOUT_MS)}`
          : `Clone failed: git exited with code ${cloned.code}`,
      );
    }
    sink.system(`Cloned in ${formatDuration(Date.now() - cloneStarted)}`);

    if (context.builder === "dockerfile") {
      return await fail(
        "build_failed",
        "Dockerfile builds arrive with INF-13. Switch this service's builder to Railpack for now.",
      );
    }
    const source = path.resolve(dir, context.rootDir);
    const inside = source === dir || source.startsWith(`${dir}${path.sep}`);
    if (!inside || !(await isDirectory(source))) {
      return await fail(
        "build_failed",
        `The root directory ${context.rootDir} isn't in the repo at ${short}`,
      );
    }

    const commands = commandVariables(context);
    const variables = splitBuildVariables({ ...context.buildVariables, ...commands });
    for (const key of variables.skipped) {
      sink.system(
        `Not passing ${key} to the build: the build tools use their own. The app gets it when it runs.`,
      );
    }
    if (commands.RAILPACK_BUILD_CMD) {
      sink.system(`Build command, from the service's settings: ${commands.RAILPACK_BUILD_CMD}`);
    }
    if (commands.RAILPACK_START_CMD) {
      sink.system(`Start command, from the service's settings: ${commands.RAILPACK_START_CMD}`);
    }
    sink.system("Building with Railpack");
    const imageTag = imageTagFor(context.serviceId, context.deploymentId);
    const timeoutMs = deps.timeoutMs ?? BUILD_TIMEOUT_MS;
    const built = await (deps.buildImage ?? railpackBuild)({
      dir: source,
      imageTag,
      buildVariables: variables.passed,
      buildkitHost: deps.buildkitHost,
      timeoutMs,
      onLine: (line) => sink.write("build", line),
      signal,
    });
    if (built.aborted) return stopped();
    const elapsed = formatDuration(Date.now() - started);
    if (built.timedOut) {
      return await fail(
        "build_timeout",
        `Build stopped after ${elapsed}: a build may take at most ${formatDuration(timeoutMs)}`,
      );
    }
    if (built.code !== 0) {
      return await fail(
        "build_failed",
        `Build failed after ${elapsed}: railpack exited with code ${built.code}`,
      );
    }
    if (!(await (deps.imageExists ?? imageExists)(imageTag))) {
      return await fail("build_failed", `Railpack finished, but Docker has no image ${imageTag}`);
    }
    sink.system(`Image built in ${elapsed}`);
    await sink.flush();
    await api.reportStatus(id, { status: "deploying", imageTag, at: at() });
    return "deploying";
  } catch (error) {
    if (error instanceof StopDeployment) {
      log.info({ deploymentId: id, reason: error.message }, "the API stopped this build");
      await logs?.flush();
      return "stopped";
    }
    if (isMissingTool(error)) {
      return await fail("build_failed", `The worker can't run ${error.path}: it isn't installed`);
    }
    log.error({ err: error, deploymentId: id }, "the build crashed");
    try {
      await fail("build_failed", "The build stopped on an error inside the worker");
    } catch {
      // The API can't be reached either; its backstop fails the deployment after 20 minutes.
    }
    throw error;
  } finally {
    deps.builds?.finish(id);
    await rm(dir, { recursive: true, force: true });
  }
}
