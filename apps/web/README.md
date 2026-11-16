# @lift/web

The dashboard and the live editor (Next.js App Router). **Owner:** WS2 Front end. **Spec:** [docs/prd/02-frontend.md](../../docs/prd/02-frontend.md).

**Today:** one placeholder page. In development, `/api/*` on this origin is proxied to the API on port 4000, so the session cookie works without CORS; `@lift/shared` is compiled through `transpilePackages`.
**Next:** FE-01 (app shell, theme tokens, Geist fonts, shadcn/ui, the mocks switch), then FE-02 to FE-05 by Nov 19.

| Command | What it does |
| --- | --- |
| `pnpm --filter web dev` | Start on port 3000 |
| `pnpm --filter web typecheck` | Generate Next's route types, then run TypeScript |
| `pnpm --filter web test` | Vitest (component tests arrive with FE-01) |
| `pnpm --filter web build` | Production build |

Pages that update live are client components. No server actions and no route handlers: the API is a separate service.
