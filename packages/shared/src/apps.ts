/**
 * How deployed apps are served under an apps domain (APPS_DOMAIN). The local stack's Traefik has
 * no certificates, so `*.localhost` apps are plain HTTP on entry point `web`; everywhere else they
 * are HTTPS on `websecure` with the wildcard certificate. The API uses it for app URLs, the worker
 * for Traefik labels, so the two always agree.
 */
export interface AppsRouting {
  scheme: "http" | "https";
  /** The Traefik entry point app routers attach to. */
  entryPoint: "web" | "websecure";
  /** Whether app routers set `tls=true`. */
  tls: boolean;
}

export function appsRouting(appsDomain: string): AppsRouting {
  const domain = appsDomain.toLowerCase();
  const local = domain === "localhost" || domain.endsWith(".localhost");
  return local
    ? { scheme: "http", entryPoint: "web", tls: false }
    : { scheme: "https", entryPoint: "websecure", tls: true };
}

/** A service's generated hostname: `{subdomain}.{appsDomain}`. */
export function appHostname(subdomain: string, appsDomain: string): string {
  return `${subdomain}.${appsDomain.toLowerCase()}`;
}

/** The URL people open for a hostname, e.g. `https://web-demo-shop.apps.trylift.dev`. */
export function appUrl(hostname: string, appsDomain: string): string {
  return `${appsRouting(appsDomain).scheme}://${hostname}`;
}
