import { Command } from "commander";

export const CLI_VERSION = "0.0.0";

/**
 * Builds the `lift` command. QA-03 adds `login`, `whoami`, `status`, the global flags (--project,
 * --service, --api-url, --json) and the exit codes from docs/prd/05-quality-delivery.md.
 */
export function createProgram(): Command {
  return new Command("lift")
    .description(
      "Deploy GitHub repos to Lift, follow their logs and manage them from your terminal",
    )
    .version(CLI_VERSION, "-v, --version", "print the CLI version");
}
