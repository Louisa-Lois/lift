# infra/traefik

Traefik v3 configuration for both routers. Compose mounts a stable copy of this folder from `/opt/lift/config/traefik`, which `infra/scripts/lift-release.sh` refreshes on each deploy; Traefik restarts only when its `traefik.yml` changes.

| Path | VM | What it does |
| --- | --- | --- |
| `control/traefik.yml` | control plane (INF-02) | Ports 80 and 443, HTTP to HTTPS, `app.{domain}` by DNS-01 through Cloudflare, routers from the labels in `infra/compose/control.yml` |
| `worker/traefik.yml` | worker (INF-03) | Ports 80 and 443, HTTP to HTTPS, routers from the labels the worker puts on app containers on `lift-edge` |
| `worker/dynamic/tls.yml` | worker | The default certificate: one wildcard for `*.apps.{domain}` by DNS-01, so deploying an app never asks Let's Encrypt for anything |

**Routing on `app.{domain}`:** `/api` → api:4000, `/collab` → collab:4200 (WebSockets pass through), `/mcp` → mcp:4300 (only with the `mcp` profile), everything else → web:3000. `/internal` is never routed; the worker reaches it on the control plane's private IP.

**Choices worth knowing:**

- **DNS-01 everywhere.** Both VMs read `CF_DNS_API_TOKEN` from `/opt/lift/.env`; the token needs Zone:Read and DNS:Edit on the one zone. Port 80 stays open only for the redirect.
- **No Docker socket in Traefik.** Each Traefik reads Docker through `tecnativa/docker-socket-proxy`, which allows GET on containers, networks, events and version only and sits on an internal network with no ports. The read-write socket goes to the worker agent alone.
- **No read timeout on 443.** Traefik v3 defaults `readTimeout` to 60 s, which cuts long uploads and long-lived WebSockets; both routers set it to 0.
- **Access logs** are JSON on stdout with every header dropped, so cookies and tokens never reach them.

Read the logs on a VM: `sudo /opt/lift/current/scripts/lift-release.sh compose logs -f traefik` (control) or `… logs -f traefik-apps` (worker).
