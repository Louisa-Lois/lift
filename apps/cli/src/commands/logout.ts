import { getClient } from "../client";
import { clearAuthConfig } from "../config";
import { type OutputContext, printJson, printText } from "../output";

export interface LogoutOptions {
  apiUrl?: string;
  configDir?: string;
}

export async function logoutCommand(options: LogoutOptions, ctx?: OutputContext): Promise<void> {
  const { client, token } = getClient(options);

  if (token) {
    try {
      await client.logout();
    } catch {
      // Best-effort remote session revocation
    }
  }

  clearAuthConfig(options.configDir);

  if (ctx?.json) {
    printJson({ status: "ok" }, ctx);
  } else {
    printText("Logged out.", ctx);
  }
}
