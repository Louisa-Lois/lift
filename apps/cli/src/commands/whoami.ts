import { getAuthenticatedClient } from "../client";
import { type OutputContext, printJson, printText } from "../output";

export interface WhoamiOptions {
  apiUrl?: string;
  configDir?: string;
}

export async function whoamiCommand(options: WhoamiOptions, ctx?: OutputContext): Promise<void> {
  const { client } = getAuthenticatedClient(options);
  const user = await client.me();

  if (ctx?.json) {
    printJson(user, ctx);
  } else {
    const namePart = user.name ? `${user.name} (@${user.login})` : `@${user.login}`;
    const emailPart = user.email ? ` <${user.email}>` : "";
    printText(`${namePart}${emailPart}`, ctx);
  }
}
