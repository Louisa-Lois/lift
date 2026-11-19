import { LiftApiError } from "@lift/shared";
import { EXIT_DEPLOY_FAILED, EXIT_ERROR, EXIT_NOT_SIGNED_IN, EXIT_USAGE } from "./constants";

export class CliError extends Error {
  constructor(
    message: string,
    public readonly exitCode = EXIT_ERROR,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export class UsageError extends CliError {
  constructor(message: string, suggestion?: string) {
    super(message, EXIT_USAGE, suggestion);
    this.name = "UsageError";
  }
}

export function formatCommanderError(error: { message: string }): UsageError {
  const cleanMessage = error.message.replace(/^error:\s*/i, "").trim();
  return new UsageError(cleanMessage, "Run `lift --help` to see available commands and options.");
}

export class NotSignedInError extends CliError {
  constructor(
    message = "Not signed in. Run `lift login`.",
    suggestion = "Run `lift login --token <token>` to authenticate.",
  ) {
    super(message, EXIT_NOT_SIGNED_IN, suggestion);
    this.name = "NotSignedInError";
  }
}

export class DeploymentFailedError extends CliError {
  constructor(message: string, suggestion?: string) {
    super(message, EXIT_DEPLOY_FAILED, suggestion);
    this.name = "DeploymentFailedError";
  }
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof LiftApiError) {
    if (error.status === 401 || error.code === "unauthenticated") {
      return new NotSignedInError(
        error.detail || "Not signed in or token expired. Run `lift login`.",
        "Run `lift login --token <token>` to sign in.",
      );
    }
    if (error.status === 403 || error.code === "forbidden") {
      return new CliError(
        `Forbidden: ${error.detail || error.message}`,
        EXIT_ERROR,
        "Make sure you have sufficient permissions for this project.",
      );
    }
    if (error.status === 404 || error.code === "not_found") {
      return new CliError(
        error.detail || error.message,
        EXIT_ERROR,
        "Check that the specified resource exists and you have access.",
      );
    }
    return new CliError(
      error.detail || error.message,
      EXIT_ERROR,
      "Check your request or try again later.",
    );
  }

  if (error instanceof Error) {
    let suggestion = "Check your command arguments and try again, or run `lift --help`.";
    const msg = error.message.toLowerCase();
    if (
      msg.includes("fetch failed") ||
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("failed to fetch")
    ) {
      suggestion =
        "Could not reach the Lift API. Check that the API server is running and reachable, or specify a different URL with --api-url.";
    }
    return new CliError(error.message, EXIT_ERROR, suggestion);
  }

  return new CliError(
    String(error),
    EXIT_ERROR,
    "Check your command arguments and try again, or run `lift --help`.",
  );
}
