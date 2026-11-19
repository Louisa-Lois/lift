import { Command, CommanderError } from "commander";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { statusCommand } from "./commands/status";
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
