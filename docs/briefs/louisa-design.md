# Louisa · Brand, theme and landing page

Nov 18, 2026. Your brief for Lift. Read [`docs/start-here.md`](../start-here.md) first; questions go to Hakim.

## What you own

How Lift looks. You design the brand (logo, colours, type), turn it into the theme every screen takes its colours and fonts from, and build the landing page people see before they sign in.

Hakim builds the dashboard screens with a default look until the demo works (target Nov 26). Every screen reads its colours, fonts and corner radius from your theme file, so your theme restyles all of them at once and neither of you edits the other's files. After the handoff on Nov 26 you polish the dashboard itself.

Until Nov 26 you change only these paths:

| Path | What goes there |
| --- | --- |
| `apps/web/src/styles/theme.css` | Every colour, font and radius variable: dark first, light if there's time |
| `apps/web/src/app/(marketing)/` | The landing page at `/`, its layout, and the style guide at `/styleguide` |
| `apps/web/src/components/marketing/` | Components used only by those pages |
| `apps/web/public/brand/` | Logo, favicon and the social preview image |

Everything else in `apps/web` is Hakim's until the handoff; if you need something there, ask him. Signed-in screens start at `/projects`, and the sign-in page is `/login`.

## Tasks

### UI-01 · Brand and theme (design by Nov 19, in code by Nov 20)

**Design first, no code.** Look at Railway, Vercel, Render and Linear for the feel; borrow ideas, never their branding.

- A wordmark or logo for Lift as SVG, plus a favicon.
- A dark palette (the default), and a light one if there's time.
- Six status colours: queued, building, deploying, active, failed, canceled. The dashboard always shows the status name next to its colour, so colour is never the only signal.
- Two fonts: one for the interface and a monospace one for logs and code. Geist Sans and Geist Mono are the defaults; any free font works.

**Then in code, from Nov 19.** Hakim's setup adds Tailwind CSS, shadcn/ui and `theme.css` with default values on Nov 19. Replace the values with yours:

- the shadcn/ui variables (`--background`, `--foreground`, `--primary`, `--muted`, `--accent`, `--border`, `--ring` and the rest of shadcn's set, each with its `-foreground` partner where shadcn has one);
- Lift's status variables: `--status-queued`, `--status-building`, `--status-deploying`, `--status-active`, `--status-failed`, `--status-canceled`;
- `--font-sans`, `--font-mono` and `--radius`.

Then build `/styleguide`: every colour as a swatch, the type scale, and the components the dashboard uses (Button, a Badge per status, Card, Table, Input, Tabs, Dialog), in dark and light.

**Done when** `/styleguide` shows the whole theme, all body text meets WCAG AA contrast (4.5:1), and Hakim's screens pick up your colours without any change to their code.

### UI-02 · Landing page (by Nov 24)

The page at `/` for people who aren't signed in. It replaces the starter placeholder, so delete `apps/web/src/app/page.tsx` in the same pull request.

- **Hero:** the pitch in one line, a sentence under it, a "Deploy from GitHub" button that goes to `/login`, and a picture of the product. Use a placeholder until real screenshots exist on Nov 26.
- **How it works:** three steps: paste a repo, the AI plans the deployment, it's live at its own HTTPS address.
- **Features:** AI that fixes failed deploys, the live editor, live logs and one-click rollback, Postgres in one click, and the `lift` CLI.
- **Footer:** the team's names, "Ashesi University · Web Technologies 2026", and the GitHub link.

Rules: no API calls, responsive down to 360 px wide, Lighthouse performance and accessibility of 90 or more on desktop, and alt text on every image. Take the copy from the proposal and agree the final words with Hakim.

**Done when** the page meets those rules and its buttons lead to `/login`.

### After the handoff (Nov 26–29)

- **UI-03 · Polish the dashboard.** Go screen by screen: spacing, empty states, loading skeletons, error states, and how it reads on a phone. From Nov 26 the dashboard's components are open to you; tell Hakim which screen you're on so you don't both edit it.
- **UI-04 · Visuals for the report, slides and video,** by Nov 29: screenshots of each demo step at 2x, the title slide, and the architecture diagram in Lift's colours.

## How to work

- Set up your machine as in `docs/start-here.md`; `pnpm --filter web dev` serves http://localhost:3000.
- One task per branch: `louisa/UI-01-brand-theme`, `louisa/UI-02-landing-page`.
- Pull requests include screenshots at desktop and phone width. Hakim reviews them.
- Never put a colour straight into a component (`bg-zinc-900`, `#7c3aed`). It goes in `theme.css`, so one change restyles the whole app.

## Kickoff prompt for your coding agent

```text
I'm Louisa. Read docs/start-here.md and docs/briefs/louisa-design.md.

Task: <UI-XX> only. Change only the paths my brief lists.
1. Restate the task and list the files you will create or change.
2. Build it with Tailwind CSS and shadcn/ui, taking every colour, font and radius from
   apps/web/src/styles/theme.css. Never hard-code a colour.
3. Run the app, check the page at desktop and phone widths in dark and light, and show me
   screenshots.

Finish with pnpm lint && pnpm --filter web typecheck && pnpm --filter web build, then summarise
what changed.
```
