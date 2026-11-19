import { createLiftClient } from "@lift/shared";
import { resolveApiUrl } from "../client";
import { loadConfig, saveConfig } from "../config";
import { NotSignedInError, UsageError } from "../errors";
import { type OutputContext, printJson, printText } from "../output";

export interface LoginOptions {
  token?: string;
  apiUrl?: string;
  configDir?: string;
}

export async function loginCommand(options: LoginOptions, ctx?: OutputContext): Promise<void> {
  const token = options.token?.trim();
  if (!token) {
    throw new UsageError(
      "Browser login is coming in QA-08. To log in with an API token, run: lift login --token <token>",
      "Pass your API token using `lift login --token <token>`.",
    );
  }

  const existingConfig = loadConfig(options.configDir);
  const resolvedUrl = resolveApiUrl(options, existingConfig);

  const client = createLiftClient({
    baseUrl: resolvedUrl,
    token,
  });

  try {
    const user = await client.me();

    saveConfig(
      {
        ...existingConfig,
        apiUrl: resolvedUrl,
        token,
        user,
      },
      options.configDir,
    );

    if (ctx?.json) {
      printJson(user, ctx);
    } else {
      const displayName = user.name ? `${user.name} (@${user.login})` : `@${user.login}`;
      printText(`Signed in as ${displayName}.`, ctx);
    }
  } catch (_err) {
    throw new NotSignedInError(
      "Invalid or expired token. Run `lift login --token <token>`.",
      "Check your token in the dashboard settings and run `lift login --token <token>`.",
    );
  }
}
