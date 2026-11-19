#!/usr/bin/env node
import { CommanderError } from "commander";
import { EXIT_SUCCESS, EXIT_USAGE } from "./constants";
import { toCliError } from "./errors";
import { printError } from "./output";
import { createProgram } from "./program";

const program = createProgram();
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (rawError) {
  if (rawError instanceof CommanderError) {
    if (rawError.code === "commander.helpDisplayed" || rawError.code === "commander.version") {
      process.exit(EXIT_SUCCESS);
    }
    process.exit(EXIT_USAGE);
  }
  const cliError = toCliError(rawError);
  const isJson = process.argv.includes("--json");
  printError(cliError, { json: isJson });
  process.exit(cliError.exitCode);
}
