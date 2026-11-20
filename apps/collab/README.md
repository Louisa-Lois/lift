# @lift/collab

The live editor's Hocuspocus server, served at `/collab` behind Traefik. **Owner:** WS1 Back end & API. **Spec:** "Live editor back end" in [docs/prd/01-backend-api.md](../../docs/prd/01-backend-api.md).

**What it does** (BE-17):
- **Who may connect:** a collab token from `POST /api/v1/services/:id/editor/session`, an HS256 JWT signed with `COLLAB_SECRET`, for one document (`{serviceId}:{path}`). Viewers get a read-only connection, and the server drops their edits.
- **Where documents live:** `editor_documents.yjs_state`. The API creates the row when a file is first opened; this server loads it and saves edits 2 seconds after the last one, or at most 10 seconds after the first. A name with no row is refused.
- **The API's internal routes** (`src/internal.ts`): `POST /internal/documents/text` and `/reset` read and replace live documents, with `Authorization: Bearer {COLLAB_SECRET}`. They answer 404 to anything that came through Traefik.
- **Health:** `/health`, or `/collab/health` behind the router.

| Command | What it does |
| --- | --- |
| `pnpm --filter collab dev` | Start on port 4200 with the root `.env` |
| `pnpm --filter collab test` | Vitest: real servers on free ports, with real providers, against the stack's Postgres |
| `pnpm --filter collab build` | Bundle to `dist/index.js` |
