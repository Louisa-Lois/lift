# @lift/collab

The live editor's Hocuspocus server, served at `/collab` behind Traefik. **Owner:** WS1 Back end & API. **Spec:** "Live editor back end" in [docs/prd/01-backend-api.md](../../docs/prd/01-backend-api.md).

**Today:** a Hocuspocus server on port 4200 with a health check (`/health`, or `/collab/health` behind the router). It refuses every editor connection until token authentication exists.
**Next:** BE-17 (collab-token check in `onAuthenticate`, the Database extension storing Yjs state, document names `{serviceId}:{path}`), by Nov 23.

| Command | What it does |
| --- | --- |
| `pnpm --filter collab dev` | Start on port 4200 with the root `.env` |
| `pnpm --filter collab test` | Vitest, starting the server on a free port |
| `pnpm --filter collab build` | Bundle to `dist/index.js` |
