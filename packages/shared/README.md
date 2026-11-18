# @lift/shared

The contracts every Lift app shares. **Owner:** everyone, through the interface rule in [docs/contracts.md](../../docs/contracts.md): changes need an issue labelled `interface`, and after the Nov 18 freeze only additive changes go in without every owner's approval.

**Today:** contracts v1 (BE-00), tagged `contracts-v1`. The plan, action, diagnosis, chat-stream and eval schemas are marked **STUB** and filled in by AI-00 (WS3).

```text
src/
├─ index.ts      # re-exports everything below, plus API_BASE_PATH, INTERNAL_BASE_PATH, DEV_PORTS
├─ ids.ts        # ID prefixes and newId(); the only place IDs are made
├─ enums.ts      # every enum: a values array, a Zod schema and a type of the same name
├─ errors.ts     # problem+json, the stable error codes, LiftApiError, LiftContractError
├─ schemas/      # one Zod file per resource, request bodies, the cursor page; plan, agent,
│                # diagnosis and eval are STUBS for AI-00
├─ events.ts     # the three SSE streams: paths, event names, Redis stream keys
├─ jobs.ts       # BullMQ queues and job payloads (strict: no unknown fields, so no secrets)
├─ internal.ts   # bodies of the worker's and agent's /internal/v1 routes
├─ client.ts     # createLiftClient(): typed methods for the routes BE-01 to BE-08 serve
└─ fixtures/     # the demo project, imported as @lift/shared/fixtures (mocks and tests only)
```

## Using it

```ts
import { createLiftClient, Service, type Deployment, newId } from "@lift/shared";

// Browser: same origin, the session cookie signs requests.
const lift = createLiftClient({ baseUrl: "/api/v1" });
// CLI and MCP: the base URL includes /api/v1, and a personal token.
const cli = createLiftClient({ baseUrl: `${process.env.LIFT_API_URL}/api/v1`, token });

const page = await lift.projects.list(); // { data, nextCursor }, checked against the schema
for await (const event of cli.deployments.streamLogs(deploymentId)) {
  if (event.event === "log") console.log(event.data.line);
}
```

- Every schema and its type share a name: `Service` is the Zod schema, `type Service` its output. Request bodies are strict (unknown fields fail); responses ignore unknown fields, so additive changes don't break older clients.
- The client throws `LiftApiError` (with the stable `code` and any `fields`) for error responses, and `LiftContractError` when a success response doesn't match its schema.
- EventSource users: build URLs with `client.urls`, and parse project-stream messages with `parseProjectStreamData` (it returns null for event types this version doesn't know).
- Fixtures: `import { project, deployments, buildLog, page } from "@lift/shared/fixtures"`. Each one is built through its schema, so a schema change that breaks a fixture fails `pnpm test`.

This package exports TypeScript source and has no build step; it runs in both Node.js and the browser, so it never imports Node built-ins. It uses `zod` at runtime: a Node app bundled by tsup that imports `@lift/shared` must list `zod` in its own dependencies.
