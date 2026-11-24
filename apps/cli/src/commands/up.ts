import { execSync } from "node:child_process";
import type { DeploymentStatus } from "@lift/shared";
import { getAuthenticatedClient } from "../client";
import { DeploymentFailedError } from "../errors";
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
      printText("Warning: current commit has not been pushed to remote.", ctx);
    }
  } catch {
    // Ignore git status errors
  }

  const deployment = await client.deployments.create(serviceId, commitSha ? { commitSha } : {});

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
  while (
    !finalStatus &&
    (detail.status === "queued" || detail.status === "building" || detail.status === "deploying")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    detail = await client.deployments.get(deployment.id);
    if (detail.status === "active" || detail.status === "failed" || detail.status === "canceled") {
      finalStatus = detail.status;
    }
  }

  finalStatus = finalStatus ?? detail.status;

  if (finalStatus === "active") {
    const service = await client.services.get(serviceId);
    if (ctx?.json) {
      printJson(detail, ctx);
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
