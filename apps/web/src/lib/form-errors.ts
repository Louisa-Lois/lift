import type * as core from "zod/v4/core";

/**
 * Plain words for Zod's generic messages on forms: "Too small: expected string to have >=1
 * characters" becomes "Required". Pass it as `zodResolver(schema, formMessages)`. A schema's own
 * message, such as RootDir's, still wins.
 */
export const formMessages: { error: core.$ZodErrorMap } = {
  error: (issue) => {
    const isNumber = issue.origin === "number" || issue.origin === "int";
    switch (issue.code) {
      case "too_small":
        if (issue.origin === "string") {
          return Number(issue.minimum) <= 1
            ? "Required"
            : `Use at least ${issue.minimum} characters`;
        }
        return isNumber ? `Use ${issue.minimum} or more` : undefined;
      case "too_big":
        if (issue.origin === "string") return `Use at most ${issue.maximum} characters`;
        return isNumber ? `Use ${issue.maximum} or less` : undefined;
      case "invalid_type":
        return issue.expected === "number" || issue.expected === "int"
          ? "Enter a whole number"
          : undefined;
      default:
        return undefined;
    }
  },
};
