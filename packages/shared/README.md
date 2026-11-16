# @lift/shared

The contracts every Lift app shares. **Owner:** everyone, through the interface rule in [docs/contracts.md](../../docs/contracts.md): changes need an issue labelled `interface`, and after the Nov 18 freeze only additive changes go in without every owner's approval.

**Today:** the API base paths, queue names and development ports.
**Next:** BE-00, contracts v1, as one pull request every owner reviews, tagged `contracts-v1` on Nov 18. Planned layout:

```text
src/
├─ index.ts      # re-exports everything below
├─ ids.ts        # ID prefixes and newId(); the only place IDs are made
├─ enums.ts      # statuses, triggers, roles, database types, …
├─ errors.ts     # problem+json shape and the stable error codes
├─ schemas/      # one Zod file per resource, plus plan, action and diagnosis (AI-00)
├─ events.ts     # SSE event names and payloads
├─ jobs.ts       # BullMQ job payloads
├─ internal.ts   # bodies of the worker's and agent's internal API calls
├─ client.ts     # createLiftClient(): the typed API client
└─ fixtures/     # sample data for mocks and tests
```

This package exports TypeScript source and has no build step; it must run in both Node.js and the browser, so it never imports Node built-ins.
