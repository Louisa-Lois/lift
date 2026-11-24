import { execSync } from "node:child_process";
import { type Deployment, type DeploymentStatus, LiftApiError } from "@lift/shared";
import { getAuthenticatedClient } from "../client";
import { CliError, DeploymentFailedError, toCliError } from "../errors";
import { type OutputContext, printJson, printText } from "../output";
import { resolveTargetProject, resolveTargetService } from "../resolve";

export interface UpOptions {
  apiUrl?: string;
  configDir?: string;
  project?: string;
  service?: string;
  cwd?: string;
}

export async function upCommand(options: UpOptions, ctx?: OutputContext): Promise<void> {
  const { client } = getAuthenticatedClient(options);

  const projectId = await resolveTargetProject(client, options);
  const serviceId = await resolveTargetService(client, projectId, options);

  const workingDir = options.cwd || process.cwd();

  let commitSha: string | undefined;
  try {
    commitSha = execSync("git rev-parse HEAD", {
      cwd: workingDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Not a git repo or git not available, proceed without commitSha
  }

  try {
    const gitStatus = execSync("git status -uno", {
      cwd: workingDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (gitStatus.includes("ahead of")) {
      const warnMsg = "Warning: current commit has not been pushed to remote.\n";
      if (ctx?.stderr) {
        ctx.stderr(warnMsg);
      } else {
        process.stderr.write(warnMsg);
      }
    }
  } catch {
    // Ignore git status errors
  }

  let deployment: Deployment;
  try {
    deployment = await client.deployments.create(serviceId, commitSha ? { commitSha } : {});
  } catch (err) {
    if (err instanceof LiftApiError && err.status === 400 && err.fields?.commitSha) {
      const shortSha = commitSha ? commitSha.slice(0, 7) : "";
      throw new CliError(
        `Commit ${shortSha} isn't on GitHub yet. Push it, then run \`lift up\` again.`,
        1,
        "Run `git push` to push your commits to GitHub.",
      );
    }
    throw toCliError(err);
  }

  if (!ctx?.json) {
    printText(`Queued deployment ${deployment.id}...`, ctx);
  }

  let finalStatus: DeploymentStatus | undefined;
  try {
    for await (const event of client.deployments.streamLogs(deployment.id)) {
      if (event.event === "log") {
        if (!ctx?.json) {
          printText(event.data.line, ctx);
        }
      } else if (event.event === "end") {
        finalStatus = event.data.status;
        break;
      }
    }
  } catch {
    // SSE stream might not be implemented in mock or network interrupted
  }

  let detail = await client.deployments.get(deployment.id);
  let pollAttempts = 0;
  const maxPollAttempts = 150; // 5 minutes at 2s interval
  while (
    !finalStatus &&
    (detail.status === "queued" || detail.status === "building" || detail.status === "deploying")
  ) {
    if (++pollAttempts > maxPollAttempts) {
      throw new CliError(
        `Deployment ${deployment.id} did not complete within timeout.`,
        1,
        `Run \`lift logs --deployment ${deployment.id} --follow\` to follow its progress.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    detail = await client.deployments.get(deployment.id);
    if (detail.status === "active" || detail.status === "failed" || detail.status === "canceled") {
      finalStatus = detail.status;
    }
  }

  finalStatus = finalStatus ?? detail.status;

  if (finalStatus === "active") {
    const service = await client.services.get(serviceId);
    if (ctx?.json) {
      printJson({ ...detail, url: service.url }, ctx);
    } else {
      printText(`Deployment live at ${service.url}`, ctx);
    }
    return;
  }

  let diagSummary = "";
  try {
    const diag = await client.deployments.diagnosis(deployment.id);
    if (diag.summary) {
      diagSummary = ` ${diag.summary}`;
    }
  } catch {
    // No diagnosis available
  }

  throw new DeploymentFailedError(
    `Deployment ${deployment.id} ${finalStatus}.${diagSummary}`.trim(),
    `Check the build logs with \`lift logs --deployment ${deployment.id}\`.`,
  );
}
