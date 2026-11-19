import { API_BASE_PATH, createLiftClient, type LiftClient } from "@lift/shared";
import { type LiftConfig, loadConfig } from "./config";
import { DEFAULT_API_URL } from "./constants";
import { NotSignedInError } from "./errors";

export interface ClientContextOptions {
  apiUrl?: string;
  configDir?: string;
  token?: string;
}

export function resolveApiUrl(options?: ClientContextOptions, config?: LiftConfig): string {
  const rawUrl = options?.apiUrl ?? process.env.LIFT_API_URL ?? config?.apiUrl ?? DEFAULT_API_URL;

  const trimmed = rawUrl.replace(/\/+$/, "");
  if (trimmed.endsWith(API_BASE_PATH)) {
    return trimmed;
  }
  return `${trimmed}${API_BASE_PATH}`;
}

export function resolveToken(
  options?: ClientContextOptions,
  config?: LiftConfig,
): string | undefined {
  return options?.token ?? process.env.LIFT_TOKEN ?? config?.token;
}

export function getClient(options?: ClientContextOptions): {
  client: LiftClient;
  token?: string;
  apiUrl: string;
} {
  const config = loadConfig(options?.configDir);
  const apiUrl = resolveApiUrl(options, config);
  const token = resolveToken(options, config);

  const client = createLiftClient({
    baseUrl: apiUrl,
    token,
  });

  return { client, token, apiUrl };
}

export function getAuthenticatedClient(options?: ClientContextOptions): {
  client: LiftClient;
  token: string;
  apiUrl: string;
} {
  const { client, token, apiUrl } = getClient(options);
  if (!token) {
    throw new NotSignedInError();
  }
  return { client, token, apiUrl };
}
