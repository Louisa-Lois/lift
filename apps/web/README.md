# @lift/web

The dashboard and the live editor (Next.js App Router). **Owner:** WS2 Front end. **Spec:** [docs/prd/02-frontend.md](../../docs/prd/02-frontend.md).

**Today:** the app shell, sign-in, the projects page, Deploy from GitHub, deployments with live logs (FE-01 to FE-05), variables (FE-07), and API tokens (part of FE-11).
- Tailwind CSS v4 and shadcn/ui take every colour, font and radius from `src/styles/theme.css`, which Louisa owns (`docs/briefs/louisa-design.md`).
- Signed-in screens live in `src/app/(app)/`, behind a guard that sends signed-out visitors to `/login?next=…`. The sign-in page explains invite-only and failed sign-ins.
- `/projects` lists project cards and creates projects; `/new` picks a repo (search, or a pasted GitHub URL) and creates a service with "Configure manually"; `/p/[projectId]` lists a project's services until FE-06's canvas.
- `/p/[projectId]/deployments/[deploymentId]` shows a deployment with its timeline and live log (virtualised, ANSI colours as spans). Logs and project events stream over `fetch`, resuming after the last event; project events update the query cache, so statuses move without a reload.
- The service panel is a sheet over `/p/[projectId]` that keeps the URL in sync (`?service=&tab=`): Deployments and Variables for now. The Variables tab masks values, reveals one for editors, stages edits until Save, has a raw `.env` editor with a review of what changes, and "Add from .env". After a save, a banner says how many changes wait for a deploy.
- `/account/tokens` (in the user menu) creates personal tokens for the CLI, shows each one once, and revokes them. The plaintext stays in the dialog's state, never in the query cache. `ConfirmDialog` asks before revoking, and before every later destructive action.
- Every request goes through the typed client in `src/lib/api.ts`; forms validate with the shared Zod schemas, and the API's field errors land on their inputs.
- `NEXT_PUBLIC_USE_MOCKS=1` answers from `@lift/shared/fixtures` (src/mocks).
- In development, `/api/*` on this origin is proxied to the API on port 4000, so the session cookie works without CORS; `@lift/shared` is compiled through `transpilePackages`.
**Next:** FE-06 (the project canvas and the service panel), then variables, databases and settings.

| Command | What it does |
| --- | --- |
| `pnpm --filter @lift/web dev` | Start on port 3000 |
| `NEXT_PUBLIC_USE_MOCKS=1 pnpm --filter @lift/web dev` | The same, answering API calls from `@lift/shared/fixtures` (`src/mocks/`); calls without a mock go to the real API |
| `pnpm --filter @lift/web typecheck` | Generate Next's route types, then run TypeScript |
| `pnpm --filter @lift/web test` | Vitest: the theme's variables, no hard-coded colours, component tests |
| `pnpm --filter @lift/web build` | Production build |

Rules:

- Colours come only from the theme: classes like `bg-card`, `text-muted-foreground`, `border-border` or `bg-status-active`, never palette classes (`bg-zinc-900`) or hex values. A test enforces it outside `src/components/ui/`.
- Add shadcn/ui components with `pnpm dlx shadcn@4.23.0 add <name> -y` from this folder. They land in `src/components/ui/`; run `pnpm format` afterwards.
- Pages that update live are client components. No server actions and no route handlers: the API is a separate service.
