import { Command, CommanderError } from "commander";
import { dbAddCommand, dbListCommand } from "./commands/db";
import { envListCommand, envSetCommand, envUnsetCommand } from "./commands/env";
import { linkCommand } from "./commands/link";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { logsCommand } from "./commands/logs";
import { redeployCommand } from "./commands/redeploy";
import { restartCommand } from "./commands/restart";
import { rollbackCommand } from "./commands/rollback";
import { statusCommand } from "./commands/status";
import { upCommand } from "./commands/up";
import { whoamiCommand } from "./commands/whoami";
import { CLI_VERSION, EXIT_SUCCESS, EXIT_USAGE } from "./constants";
import { formatCommanderError, toCliError } from "./errors";
import { type OutputContext, printError } from "./output";

export { CLI_VERSION };

export interface ProgramContextOptions {
  configDir?: string;
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export interface GlobalOptions {
  apiUrl?: string;
  project?: string;
  service?: string;
  json?: boolean;
}

export function createProgram(ctxOptions?: ProgramContextOptions): Command {
  const program = new Command("lift")
    .description(
      "Deploy GitHub repos to Lift, follow their logs and manage them from your terminal",
    )
    .version(CLI_VERSION, "-v, --version", "print the CLI version")
    .option("--api-url <url>", "Lift API base URL")
    .option("--project <project>", "target project ID or slug")
    .option("--service <service>", "target service ID or slug")
    .option("--json", "machine-readable JSON output (no colours or spinners)");

  const getOutputContext = (cmd: Command): OutputContext => {
    const opts = cmd.optsWithGlobals() as GlobalOptions;
    return {
      json: Boolean(opts.json),
      stdout: ctxOptions?.stdout,
      stderr: ctxOptions?.stderr,
    };
  };

  program
    .command("login")
    .description("Sign in to Lift with an API token")
    .option("-t, --token <token>", "API token starting with lift_pat_")
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions & { token?: string };
      const ctx = getOutputContext(cmd);
      await loginCommand(
        {
          token: globalOpts.token,
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
        },
        ctx,
      );
    });

  program
    .command("logout")
    .description("Sign out and remove saved credentials")
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await logoutCommand(
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
        },
        ctx,
      );
    });

  program
    .command("whoami")
    .description("Show the currently signed-in user")
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await whoamiCommand(
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
        },
        ctx,
      );
    });

  program
    .command("status")
    .description("Show status of all services in the linked or specified project")
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await statusCommand(
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          service: globalOpts.service,
          cwd: ctxOptions?.cwd,
        },
        ctx,
      );
    });

  program
    .command("link")
    .description("Link current directory to a Lift project and service")
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await linkCommand(
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          service: globalOpts.service,
          cwd: ctxOptions?.cwd,
        },
        ctx,
      );
    });

  program
    .command("up")
    .description("Deploy the current commit and stream logs until live")
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await upCommand(
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          service: globalOpts.service,
          cwd: ctxOptions?.cwd,
        },
        ctx,
      );
    });

  program
    .command("logs")
    .description("View deployment build logs or stream live logs")
    .option("-d, --deployment <id>", "deployment ID to view logs for")
    .option("-f, --follow", "follow logs in real time")
    .option("--tail <lines>", "number of lines to show from the end", (v) => Number.parseInt(v, 10))
    .action(async (options: { deployment?: string; follow?: boolean; tail?: number }, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await logsCommand(
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          service: globalOpts.service,
          cwd: ctxOptions?.cwd,
          deployment: options.deployment,
          follow: options.follow,
          tail: options.tail,
        },
        ctx,
      );
    });

  const envCmd = program
    .command("env")
    .description("Manage environment variables for a service")
    .option("--reveal", "reveal secret variable values")
    .action(async (options: { reveal?: boolean }, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await envListCommand(
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          service: globalOpts.service,
          cwd: ctxOptions?.cwd,
          reveal: options.reveal,
        },
        ctx,
      );
    });

  envCmd
    .command("set <pairs...>")
    .description("Set environment variables (KEY=VALUE ...)")
    .action(async (pairs: string[], _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await envSetCommand(
        pairs,
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          service: globalOpts.service,
          cwd: ctxOptions?.cwd,
        },
        ctx,
      );
    });

  envCmd
    .command("unset <keys...>")
    .description("Unset environment variables by key")
    .action(async (keys: string[], _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await envUnsetCommand(
        keys,
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          service: globalOpts.service,
          cwd: ctxOptions?.cwd,
        },
        ctx,
      );
    });

  const dbCmd = program
    .command("db")
    .description("Manage databases for a project")
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await dbListCommand(
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          cwd: ctxOptions?.cwd,
        },
        ctx,
      );
    });

  dbCmd
    .command("list")
    .description("List databases in the project")
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await dbListCommand(
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          cwd: ctxOptions?.cwd,
        },
        ctx,
      );
    });

  dbCmd
    .command("add <type>")
    .description("Add a database to the project (e.g. postgres)")
    .action(async (type: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await dbAddCommand(
        type,
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          cwd: ctxOptions?.cwd,
        },
        ctx,
      );
    });

  program
    .command("rollback [deploymentId]")
    .description("Roll back to a specific deployment or the previous active deployment")
    .action(async (deploymentId: string | undefined, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await rollbackCommand(
        deploymentId,
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          service: globalOpts.service,
          cwd: ctxOptions?.cwd,
        },
        ctx,
      );
    });

  program
    .command("redeploy")
    .description("Trigger a new deployment for the current commit")
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await redeployCommand(
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          service: globalOpts.service,
          cwd: ctxOptions?.cwd,
        },
        ctx,
      );
    });

  program
    .command("restart")
    .description("Restart the running container for a service")
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const ctx = getOutputContext(cmd);
      await restartCommand(
        {
          apiUrl: globalOpts.apiUrl,
          configDir: ctxOptions?.configDir,
          project: globalOpts.project,
          service: globalOpts.service,
          cwd: ctxOptions?.cwd,
        },
        ctx,
      );
    });

  return program;
}

export interface RunCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCli(
  args: string[],
  options?: { configDir?: string; cwd?: string },
): Promise<RunCliResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const ctx: OutputContext = {
    stdout: (text) => stdoutChunks.push(text),
    stderr: (text) => stderrChunks.push(text),
  };

  const program = createProgram({
    configDir: options?.configDir,
    cwd: options?.cwd,
    stdout: ctx.stdout,
    stderr: ctx.stderr,
  });

  program.exitOverride();
  program.configureOutput({
    writeOut: (text) => ctx.stdout?.(text),
    writeErr: (text) => ctx.stderr?.(text),
    outputError: () => {},
  });

  try {
    await program.parseAsync(["node", "lift", ...args]);
    return {
      exitCode: EXIT_SUCCESS,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
    };
  } catch (rawError) {
    if (rawError instanceof CommanderError) {
      if (rawError.code === "commander.helpDisplayed" || rawError.code === "commander.version") {
        return {
          exitCode: EXIT_SUCCESS,
          stdout: stdoutChunks.join(""),
          stderr: stderrChunks.join(""),
        };
      }
      const usageError = formatCommanderError(rawError);
      const jsonMode = args.includes("--json");
      printError(usageError, { ...ctx, json: jsonMode });
      return {
        exitCode: EXIT_USAGE,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
      };
    }

    const cliError = toCliError(rawError);
    const jsonMode = args.includes("--json");
    printError(cliError, { ...ctx, json: jsonMode });

    return {
      exitCode: cliError.exitCode,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
    };
  }
}
