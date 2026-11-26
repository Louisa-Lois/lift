# PRD 2 · Front end

> Read together with `docs/contracts.md`. Built by Hakim until the demo works (target Nov 26); Louisa owns the brand, theme and landing page (`docs/briefs/louisa-design.md`). `docs/start-here.md` has the current dates, which replace the ones below. Paste the kickoff prompt at the bottom into your coding agent to start.

## Goal, scope and design references

**WS2 builds the dashboard and the live editor: every screen a person uses to deploy, watch, fix and edit an app.** By Nov 23 every demo step can be clicked through; by Nov 28 the editor, the AI plan review and the agent chat are in.

- **Builder:** Hakim, for every screen below. **Louisa** owns `src/styles/theme.css`, the landing page at `/`, the style guide and the brand assets, and polishes the dashboard after the handoff.
- **Owns:** `apps/web`.
- **Depends on:** WS1's API, streams and collab server; WS3's plan, chat and diagnosis endpoints. Mocks stand in for all of them until they are live.

**Design references** (borrow the pattern, never the branding):

| Product | What to borrow |
| --- | --- |
| Railway | The project canvas: services and databases as cards with a live status dot; clicking a card opens a side panel with tabs (Deployments, Variables, Logs, Metrics, Settings); staged variable changes with a "Deploy changes" banner |
| Vercel | The deployments list (status, commit message, branch, author, age, duration) and the build log page; the restraint: dark neutral surfaces, one accent, Geist type, skeleton loading |
| Render | The per-service events timeline ("Deploy started for a1b2c3d", "Deploy live") and the log explorer with search and time range; "Add from .env" for variables |
| Linear | Speed and keyboard-first navigation: a ⌘K command menu and shortcuts shown in tooltips |
| Replit, CodeSandbox, Figma | The collaborative editor: file tree on the left, tabs, editor in the middle, avatars top right, coloured cursors with name flags |
| GitHub | Unified diffs for AI-proposed patches (Monaco's diff editor) |

**In scope:** sign-in; projects list; deploy from GitHub (repo picker and AI plan review); project canvas and service panel; deployments, deployment page and live logs; variables; databases; runtime logs; usage page (table); settings, members, tokens, CLI approval page; live editor; agent chat drawer; AI diagnosis card; evals page shell.

**Out of scope:** billing pages, team switcher, editing on phones.

**Cut order if behind:** metrics charts → ⌘K menu → usage chart → AI suggestions inside the editor → light theme.

## Screens and routes

| Route | Screen | What is on it | Data |
| --- | --- | --- | --- |
| `/login` | Sign in | Logo, one-line pitch, "Continue with GitHub" | `GET /auth/github/start` |
| `/` | Landing page (Louisa) | Pitch, how it works, features, and a "Deploy from GitHub" button that goes to `/login` | none |
| `/projects` | Projects | Grid of project cards (name, service count, status dots, last deploy age); "New project" | `GET /projects` |
| `/new` | Deploy from GitHub | Searchable repo list (owner/name, private badge, last push) or a pasted GitHub URL; "Continue" starts the AI plan; "Configure manually" opens the plain form | `GET /github/repos`, `POST /agent/plans` |
| `/new/plan/[planId]` | Review plan | The assistant's summary; editable service cards; database toggles; variables table with source badges; "Approve and deploy" | plan response, `POST /agent/plans/:id/apply` |
| `/p/[projectId]` | Project canvas | Service and database cards in a grid; "+ New" menu (service from GitHub, Postgres, Redis); activity feed in a collapsible right rail | `GET /projects/:id`, project stream |
| `/p/[projectId]?service=[id]&tab=…` | Service panel (a sheet over the canvas) | Header: name, status, URL, "Redeploy", "Open editor"; tabs: Deployments · Variables · Logs · Metrics · Domains · Settings | service routes |
| `/p/[projectId]/deployments/[deploymentId]` | Deployment | Status, commit (short SHA linked to GitHub), trigger, duration, "Visit", "Rollback", "Cancel"; timeline; full-height log viewer; AI diagnosis card if it failed | `GET /deployments/:id`, log stream, diagnosis |
| `/p/[projectId]/services/[serviceId]/editor` | Live editor | File tree, tabs, Monaco, presence avatars, changes list, "Commit & deploy" | editor routes, collab WebSocket |
| `/p/[projectId]/usage` | Usage | Per service: vCPU-hours, GB-hours, estimated cost; total; an "illustrative pricing" note | `GET /projects/:id/usage` |
| `/p/[projectId]/settings` | Project settings | Rename; members (invite by GitHub login, role select, remove); delete project (type the name to confirm) | projects and members routes |
| `/account/tokens` | API tokens | Create (name, scope), copy-once dialog, revoke | tokens routes |
| `/cli-auth?code=…` | Approve CLI login | The code in large type; "Approve" and "Deny" | `POST /auth/cli/:code/approve` |
| `/evals` | Evaluation results | Page shell and layout; WS3 builds the content components | `GET /evals/runs` |
| any project page | Agent chat drawer | Opens with ⌘J or the sparkle button; a right-side drawer | agent messages stream |

## Design system and key screen specs

### Tokens

- **Theme:** dark by default (light is on the cut list). Background `zinc-950`, raised surfaces `zinc-900`, borders `zinc-800`, primary text `zinc-100`, secondary text `zinc-400`.
- **Accent:** one colour, `violet-500`, for primary buttons, focus rings and selection only.
- **Status colours:** `queued` zinc-400 · `building` amber-400 with a pulsing dot · `deploying` sky-400 pulsing · `active` emerald-500 · `failed` red-500 · `canceled` and `superseded` zinc-500. Always pair the colour with a text label.
- **Type:** Geist Sans for the interface, Geist Mono for logs, IDs and code. 14 px base, 12.5 px logs.
- **Shape and space:** 8 px radius, 4 px spacing scale, 36 px table rows, 1 px borders instead of shadows.
- **Components:** shadcn/ui throughout: Button, Card, Sheet, Tabs, Table, Dialog, DropdownMenu, Command, Tooltip, Badge, Skeleton, and sonner for toasts.

These are starting values. Louisa owns them in `src/styles/theme.css`, along with the status variables `--status-queued` to `--status-canceled`. Since UI-01 her brand theme replaces them, with fonts (Inter, JetBrains Mono and Space Grotesk for headings) self-hosted in `public/brand/fonts`, and `/styleguide` shows every value. Components use only the theme's classes and variables, never palette classes or hex values, so her theme restyles every screen.

**Build these shared components first:** `AppShell` (top bar with logo, project switcher, ⌘K hint, user menu) · `StatusBadge` · `ServiceCard` · `DatabaseCard` · `DeploymentRow` · `LogViewer` · `Timeline` · `EnvTable` · `CopyButton` · `EmptyState` · `ConfirmDialog` · `DiffView` (Monaco diff editor) · `PresenceAvatars`.

### Log viewer (appears on four screens; build it first)

- Virtualised list (react-virtuoso) so 50,000 lines scroll smoothly; keep at most 50,000 lines in memory, dropping the oldest.
- Monospace, line numbers, optional timestamps, ANSI colours rendered (anser), and the stream (`build`, `deploy`, `runtime`, `system`) as a faint label on the left.
- Auto-scrolls while you are at the bottom; scrolling up pauses it and shows a "Jump to latest" pill.
- Search box with a match count and next/previous; "Copy" and "Download .log".
- Reconnects automatically with `Last-Event-ID` and shows "Reconnecting…" while disconnected.

### Deployments list (the Vercel pattern)

Each row: status badge, short SHA linking to the GitHub commit, commit message on one truncated line, trigger icon (push, manual, rollback, agent, editor, CLI), author avatar, relative time, duration. Row menu: View logs · Rollback to this · Copy ID. New deployments slide in at the top from the project stream without a refetch.

### Variables tab (the Railway and Render patterns)

- Table: KEY · value (masked, with an eye icon to reveal for editors) · source badge (`you`, `database`, `agent`) · delete.
- A "Raw editor" toggle shows the whole set as `.env` text, with a diff preview before saving. "Add from .env" pastes many at once.
- After saving, a sticky banner says "3 changes staged. Deploy to apply." with a "Deploy" button.

### Project canvas (a simplified Railway canvas)

- A responsive grid, not a free-form canvas: services first, then databases, on a dotted-grid background.
- Service card: framework icon (from the plan, or a generic box), name, status badge, domain link, "Deployed 3m ago". Database card: type icon, name, status, "Used by 2 services".
- The selected card gets an accent outline; the service panel opens as a right sheet at 60% width and keeps the URL in sync (`?service=&tab=`) so it can be shared.
- An empty project shows one large "Deploy from GitHub" call to action.

### Plan review (the "paste a URL" moment)

- Left: one card per service with editable name, root directory, build command, start command, port and health-check path; hovering a field shows the assistant's one-line rationale.
- Databases: a toggle for each one the assistant suggests.
- Variables table: key, service and a source badge, either **Lift fills this** (database or generated) or **You provide** (input required). "Approve and deploy" stays disabled until every required value is filled.
- Right: the assistant's summary, warnings and a confidence badge.

### Live editor

- Three resizable columns: file tree (240 px), editor (tabs plus Monaco), and an optional right rail (changes list and AI suggestions).
- Header: service name, branch, connection status (Connected or Reconnecting), presence avatars (up to 5, then "+N"), "Changes (3)", and the primary "Commit & deploy".
- Collaboration: one `HocuspocusProvider` per open file, URL from `NEXT_PUBLIC_COLLAB_URL`, `name` set to the `documentName` and `token` to the token from the session endpoint; bind `ydoc.getText("content")` to the Monaco model with y-monaco's `MonacoBinding`, passing the provider's awareness. Set the local awareness user from the session response so cursors show each person's name and colour.
- A dot on a tab means the file differs from the last commit. Viewers get a read-only editor and no commit button. Binary files open a "Can't edit binary files" placeholder.
- Commit dialog: a message prefilled with "Update {file}", a checkbox list of changed files, and "Commit & deploy". Success shows a toast linking to the new deployment; a 409 lists the files that changed upstream with "Discard and reload".

### Agent chat drawer

- Streams the reply as it is written. Tool use shows as compact chips ("Read build logs", "Set PORT=8080").
- Write actions arrive as approval cards: what will change, a diff if it is a patch, "Approve" and "Reject". After approval the card shows the result and a link, such as to the new deployment.
- When empty, suggested prompts: "Why did my last deploy fail?", "Add a Redis cache", "Roll back to yesterday's version".

### AI diagnosis card (failed deployments)

"What went wrong" in one sentence; the evidence as highlighted log lines that jump to their place in the viewer; what the assistant did (attempt 1 of 3, and the change it made); and, for code problems, the proposed patch in a diff with "Open in editor".

## Data layer, mocks and non-functional requirements

### Talking to the API

- Use the typed client from `packages/shared` (`createLiftClient({ baseUrl: "/api/v1" })`); never hand-write request or response types.
- TanStack Query for every read, with keys from one factory in `src/lib/query-keys.ts`: `["projects"]`, `["project", id]`, `["service", id]`, `["deployments", serviceId]`, `["deployment", id]`, `["variables", serviceId]`, `["databases", projectId]`, `["usage", projectId]`.
- `useProjectEvents(projectId)` opens the project stream once per project page and writes changes straight into the query cache with `setQueryData`, so cards and lists update live without refetching.
- `useLogStream(url)` wraps EventSource with resume and backoff (1 s, 2 s, 5 s, then every 10 s).
- Forms use react-hook-form with Zod resolvers built from the shared schemas, so validation matches the API exactly.
- Errors: a problem+json `title` becomes a toast; `fields` map onto form fields; a `401` sends you to `/login?next=…`.

### Mocks, so you never wait

- Mock Service Worker handlers in `src/mocks/`, built from `packages/shared/fixtures` and switched on with `NEXT_PUBLIC_USE_MOCKS=1`.
- A fake stream replays a recorded build log at a realistic pace (about 40 lines a second, with pauses) ending in `active` or `failed`, so the log viewer and live status can be finished on day one.
- A mock collaboration mode runs two editors against one in-memory Y.Doc on the same page, so presence and cursors can be built before the collab server is up.
- Switch each screen to the real API as WS1 ships its routes; by Nov 23 mocks remain only in component tests.

### Structure

```text
apps/web/src/
├─ app/                  # the routes above (App Router)
├─ components/ui/        # shadcn/ui primitives
├─ components/           # LogViewer, DeploymentRow, ServiceCard, EnvTable, editor/*, agent/*
├─ lib/                  # client setup, query keys, stream hooks, formatting (time, duration, bytes)
├─ mocks/                # MSW handlers and fake streams
└─ styles/
```

Pages that update live are client components. There are no Next.js server actions, because the API is a separate service.

### Non-functional

- First load under 2 s on campus Wi-Fi; route changes under 300 ms with cached data; skeletons for anything slower.
- Smooth log streaming at 10,000 lines a minute.
- Every action reachable by keyboard; visible focus rings; `aria-live` on status changes and toasts; WCAG AA contrast.
- Desktop first (1280 px and up, usable at 1024 px). On phones, the projects list, deployment status and logs stay readable; the editor shows "Open on a larger screen".
- Security headers: `X-Frame-Options: DENY` and `Referrer-Policy: strict-origin-when-cross-origin` in `next.config`, and a Content-Security-Policy with a new nonce on every request in `src/proxy.ts` (report-only until it's shown to block nothing the app needs); never render HTML that came from a user or a log.

## Requirements, acceptance tests and agent kickoff prompt

### By Nov 19 (hello world live)

- [ ] **FE-01** App shell; Tailwind CSS and shadcn/ui set up with every colour, font and radius as a variable in `src/styles/theme.css` (Louisa owns the values), including `--status-queued` to `--status-canceled`; the mocks switch. Build this first, since Louisa's theme work starts from it
- [ ] **FE-02** Sign-in page and auth guard (`/me`, redirect with `next`)
- [ ] **FE-03** Projects list and create project
- [ ] **FE-04** New service from GitHub: repo picker and the manual configuration form
- [ ] **FE-05** Deployments list, deployment page, and the log viewer streaming live

### By Nov 23 (everything works by hand)

- [ ] **FE-06** Project canvas, service and database cards, service panel with URL-synced tabs, live updates from the project stream
- [ ] **FE-07** Variables tab: table, reveal, raw editor, add from .env, staged banner
- [ ] **FE-08** Databases: add Postgres or Redis, status, reveal credentials, delete
- [ ] **FE-09** Runtime logs tab with search
- [ ] **FE-10** Redeploy, rollback, cancel and restart, with confirmations
- [ ] **FE-11** Project settings and members; API tokens page; CLI approval page
- [ ] **FE-12** Usage page (table)

### By Nov 28 (AI and editor done)

- [ ] **FE-13** Live editor: tree, tabs, Monaco, collab provider, presence, changes, commit dialog, 409 handling
- [ ] **FE-14** Plan review wired to `POST /agent/plans` and apply
- [ ] **FE-15** Agent chat drawer with streaming, tool chips and approval cards
- [ ] **FE-16** AI diagnosis card on failed deployments
- [ ] **FE-17** Evals page shell, for WS3 to fill
- [ ] **FE-18** Polish: empty, loading and error states everywhere; keyboard shortcuts
- [ ] **FE-19** (cut list) Metrics charts and the ⌘K menu

### Acceptance tests (Playwright, owned with WS5)

- Sign in, create a service from the demo repo, and watch its card go from building to active without reloading.
- Change a variable, see the staged banner, deploy, and see the new deployment at the top of the list.
- Add Postgres; within a minute its card is ready and the service's variables show `DATABASE_URL` from `database`.
- Open the same file in two browser contexts: text typed in one appears in the other within 1 second, with the other person's named cursor.
- Commit from the editor and land on a new deployment with trigger `editor`.
- A failed deployment shows the diagnosis card; rollback from the deployments list produces a new active deployment.
- As a viewer, no write button renders anywhere.

### Agent kickoff prompt

```text
You are working in the Lift monorepo. Before anything else, read AGENTS.md, docs/contracts.md
and docs/prd/02-frontend.md.

Scope: apps/web only. Use the typed client and schemas from packages/shared; never redefine API
types. Until an endpoint is live, use the MSW mocks in apps/web/src/mocks.

Task: implement requirement <FE-XX> only.
1. Restate what the screen or component must do and list the files you will touch.
2. Build it with shadcn/ui and the tokens in the PRD; follow the referenced pattern (Railway,
   Vercel, Render) without copying their branding.
3. Add a component or Playwright test for its acceptance criteria.

Rules: dark theme by default; colours only from theme.css; colour is never the only signal;
everything works by keyboard; no server actions; no new dependencies without saying why.

Finish by running `pnpm lint && pnpm typecheck && pnpm --filter web test`, then summarise what
changed and describe or screenshot the result.
```
