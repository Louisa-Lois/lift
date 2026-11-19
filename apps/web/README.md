# @lift/web

The dashboard and the live editor (Next.js App Router). **Owner:** WS2 Front end. **Spec:** [docs/prd/02-frontend.md](../../docs/prd/02-frontend.md).

**Today:** the app shell (FE-01). Tailwind CSS v4 and shadcn/ui take every colour, font and radius from `src/styles/theme.css`, which Louisa owns (`docs/briefs/louisa-design.md`). Signed-in screens live in `src/app/(app)/`, starting with `/projects`. In development, `/api/*` on this origin is proxied to the API on port 4000, so the session cookie works without CORS; `@lift/shared` is compiled through `transpilePackages`.
**Next:** FE-02 to FE-05 (sign-in, projects, new service, deployments and live logs).

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
