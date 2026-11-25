"use client";

import { DeploymentStatus } from "@lift/shared";
import { Rocket, RotateCcw } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { STATUS_STYLES, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { contrastRatio, parseRgb, type Rgb, toHex } from "./contrast";

type Mode = "dark" | "light";

/** The six statuses the brief asks for (superseded reuses canceled's colour). */
const STATUSES = DeploymentStatus.options.filter((status) => status !== "superseded");

const COLOUR_GROUPS: { title: string; note: string; tokens: string[] }[] = [
  {
    title: "Surfaces",
    note: "Page, raised surfaces, quiet fills and hover.",
    tokens: ["background", "card", "popover", "muted", "secondary", "accent", "sidebar"],
  },
  {
    title: "Text",
    note: "Each sits on the surface its name pairs with.",
    tokens: [
      "foreground",
      "muted-foreground",
      "card-foreground",
      "secondary-foreground",
      "accent-foreground",
      "primary-foreground",
    ],
  },
  {
    title: "Interaction",
    note: "Primary actions, focus rings, errors and edges.",
    tokens: ["primary", "ring", "destructive", "border", "input"],
  },
  {
    title: "Status",
    note: "Always shown next to the status name, never on its own.",
    tokens: STATUSES.map((status) => `status-${status}`),
  },
  { title: "Charts", note: "", tokens: ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] },
  {
    title: "Brand",
    note: "The same in both modes. For marketing pages and illustrations, not interface chrome.",
    tokens: [
      "brand-purple",
      "brand-coral",
      "brand-amber",
      "brand-tangerine",
      "brand-cyan",
      "brand-deep-space",
      "brand-frost",
    ],
  },
];

/** Text on a surface: must reach 4.5:1 (WCAG AA for body text). */
const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["accent-foreground", "accent"],
  ["destructive", "background"],
  ["destructive", "card"],
  ["primary", "card"],
];

/** Non-text marks (status dots, focus rings): must reach 3:1 (WCAG 1.4.11). */
const MARK_PAIRS: [string, string][] = [
  ...STATUSES.flatMap(
    (status) =>
      [
        [`status-${status}`, "background"],
        [`status-${status}`, "card"],
      ] as [string, string][],
  ),
  ["ring", "background"],
];

const TYPE_SCALE: {
  token: string;
  font: string;
  weight: number;
  size: string;
  lineHeight: number;
  sample: string;
  extra?: CSSProperties;
}[] = [
  {
    token: "display",
    font: "--font-display",
    weight: 700,
    size: "48px",
    lineHeight: 1.1,
    sample: "Ground to Orbit.",
  },
  {
    token: "h1",
    font: "--font-display",
    weight: 600,
    size: "32px",
    lineHeight: 1.2,
    sample: "Your projects",
  },
  {
    token: "h2",
    font: "--font-display",
    weight: 600,
    size: "22px",
    lineHeight: 1.25,
    sample: "Deployments",
  },
  {
    token: "h3",
    font: "--font-display",
    weight: 500,
    size: "17px",
    lineHeight: 1.3,
    sample: "Environment variables",
  },
  {
    token: "body",
    font: "--font-sans",
    weight: 400,
    size: "15px",
    lineHeight: 1.6,
    sample: "Paste a repo. The AI plans the deployment, and it's live at its own HTTPS address.",
  },
  {
    token: "body-sm",
    font: "--font-sans",
    weight: 400,
    size: "13px",
    lineHeight: 1.5,
    sample: "Last deployed 4 minutes ago from main.",
  },
  {
    token: "ui",
    font: "--font-sans",
    weight: 500,
    size: "14px",
    lineHeight: 1.4,
    sample: "Deploy from GitHub",
  },
  {
    token: "label",
    font: "--font-sans",
    weight: 600,
    size: "11px",
    lineHeight: 1.2,
    sample: "Build logs",
    extra: { textTransform: "uppercase", letterSpacing: "0.04em" },
  },
  {
    token: "mono",
    font: "--font-mono",
    weight: 450,
    size: "13px",
    lineHeight: 1.6,
    sample: "$ lift up  →  live at myapp.trylift.dev  (a1b2c3d, 0Ol1I)",
  },
  {
    token: "expressive",
    font: "--font-expressive",
    weight: 800,
    size: "44px",
    lineHeight: 1.05,
    sample: "Liftoff.",
  },
];

const DEPLOYMENTS: {
  sha: string;
  message: string;
  status: (typeof STATUSES)[number];
  when: string;
}[] = [
  { sha: "a1b2c3d", message: "Add pricing copy", status: "active", when: "2 min ago" },
  { sha: "9f8e7d6", message: "Bump Next.js", status: "deploying", when: "5 min ago" },
  { sha: "5c4b3a2", message: "Fix port in Dockerfile", status: "building", when: "6 min ago" },
  { sha: "1a2b3c4", message: "Try Node 25", status: "failed", when: "1 hr ago" },
  { sha: "7d6e5f4", message: "Rename env var", status: "queued", when: "1 hr ago" },
  { sha: "3e2d1c0", message: "Revert logging", status: "canceled", when: "Yesterday" },
];

/** Resolves a theme variable to the colour the browser actually paints. */
function resolve(token: string): Rgb | null {
  const probe = document.createElement("span");
  probe.style.color = `var(--${token})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return parseRgb(value);
}

const TOKENS = [
  ...new Set([
    ...COLOUR_GROUPS.flatMap((group) => group.tokens),
    ...TEXT_PAIRS.flat(),
    ...MARK_PAIRS.flat(),
  ]),
];

/**
 * Previews light mode by taking the dark class off <html> (and puts it back on the way out), then
 * reads every token's painted colour in the mode now showing.
 */
function useMode(): [Mode, (mode: Mode) => void, Record<string, Rgb | null>] {
  const [mode, setMode] = useState<Mode>("dark");
  const [colours, setColours] = useState<Record<string, Rgb | null>>({});
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    return () => {
      root.classList.toggle("dark", wasDark);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    // Read on the next frame, once the browser has applied the new class.
    const frame = requestAnimationFrame(() => {
      setColours(Object.fromEntries(TOKENS.map((token) => [token, resolve(token)])));
    });
    return () => cancelAnimationFrame(frame);
  }, [mode]);
  return [mode, setMode, colours];
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-border border-t pt-10">
      <h2
        id={`${id}-title`}
        className="font-semibold text-[22px] leading-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
      {intro ? <p className="mt-1 max-w-prose text-muted-foreground">{intro}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Swatch({ token, rgb }: { token: string; rgb: Rgb | null | undefined }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <div className="h-14 border-border border-b" style={{ background: `var(--${token})` }} />
      <div className="px-2.5 py-2">
        <p className="truncate font-medium text-xs">--{token}</p>
        <p className="font-mono text-muted-foreground text-xs">{rgb ? toHex(rgb) : "…"}</p>
      </div>
    </div>
  );
}

function ContrastRow({
  fg,
  bg,
  min,
  colours,
}: {
  fg: string;
  bg: string;
  min: number;
  colours: Record<string, Rgb | null>;
}) {
  const a = colours[fg];
  const b = colours[bg];
  const ratio = a && b ? contrastRatio(a, b) : null;
  const pass = ratio !== null && ratio >= min;
  return (
    <TableRow>
      <TableCell>
        <span
          className="inline-flex items-center rounded-md px-2 py-1 font-medium text-xs"
          style={{ color: `var(--${fg})`, background: `var(--${bg})` }}
        >
          Aa
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs">--{fg}</TableCell>
      <TableCell className="font-mono text-xs">--{bg}</TableCell>
      <TableCell className="font-mono text-xs tabular-nums">
        {ratio ? `${ratio.toFixed(2)}:1` : "…"}
      </TableCell>
      <TableCell>
        {ratio === null ? null : pass ? (
          <Badge variant="outline">Pass · {min}:1</Badge>
        ) : (
          <Badge variant="destructive">Fails {min}:1</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

export function StyleGuide() {
  const [mode, setMode, colours] = useMode();
  const failures = [
    ...TEXT_PAIRS.map((pair) => [...pair, 4.5] as const),
    ...MARK_PAIRS.map((pair) => [...pair, 3] as const),
  ].filter(([fg, bg, min]) => {
    const a = colours[fg];
    const b = colours[bg];
    return a && b && contrastRatio(a, b) < min;
  });

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-border border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="flex items-center gap-4">
            {/* biome-ignore lint/performance/noImgElement: a static SVG from public/, no optimisation needed */}
            <img
              src={
                mode === "dark" ? "/brand/lift-wordmark-dark.svg" : "/brand/lift-wordmark-light.svg"
              }
              alt="Lift"
              width={101}
              height={40}
              className="h-8 w-auto"
            />
            <span className="text-muted-foreground">Style guide</span>
          </div>
          <fieldset className="inline-flex rounded-lg border border-border bg-muted p-[3px]">
            <legend className="sr-only">Preview mode</legend>
            {(["dark", "light"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className="rounded-md px-3 py-1 font-medium text-muted-foreground text-sm capitalize transition-colors aria-pressed:bg-background aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                {option}
              </button>
            ))}
          </fieldset>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-10 sm:px-6">
        <div className="max-w-2xl">
          <h1
            className="font-semibold text-[32px] leading-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Lift's theme
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Every colour, font and component the dashboard uses, read live from{" "}
            <code className="font-mono text-foreground text-sm">src/styles/theme.css</code>. Switch
            between dark and light to check both.
          </p>
        </div>

        <Section
          id="colours"
          title="Colours"
          intro="The hex under each swatch is what the browser paints right now, in the selected mode."
        >
          <div className="flex flex-col gap-8">
            {COLOUR_GROUPS.map((group) => (
              <div key={group.title}>
                <h3
                  className="font-medium text-[17px]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {group.title}
                </h3>
                {group.note ? (
                  <p className="mb-3 text-muted-foreground text-sm">{group.note}</p>
                ) : (
                  <div className="mb-3" />
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {group.tokens.map((token) => (
                    <Swatch key={token} token={token} rgb={colours[token]} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="contrast"
          title="Contrast"
          intro="Text needs 4.5:1 against what it sits on (WCAG AA). Status dots and focus rings need 3:1. Worked out live from the values above."
        >
          <p
            role="status"
            className={
              failures.length
                ? "mb-4 font-medium text-destructive"
                : "mb-4 font-medium text-foreground"
            }
          >
            {failures.length
              ? `${failures.length} pair${failures.length === 1 ? "" : "s"} below the minimum in ${mode} mode.`
              : `Every pair passes in ${mode} mode.`}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sample</TableHead>
                  <TableHead>Foreground</TableHead>
                  <TableHead>Background</TableHead>
                  <TableHead>Ratio</TableHead>
                  <TableHead>WCAG</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TEXT_PAIRS.map(([fg, bg]) => (
                  <ContrastRow key={`${fg}-${bg}`} fg={fg} bg={bg} min={4.5} colours={colours} />
                ))}
                {MARK_PAIRS.map(([fg, bg]) => (
                  <ContrastRow key={`${fg}-${bg}`} fg={fg} bg={bg} min={3} colours={colours} />
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>

        <Section
          id="type"
          title="Type"
          intro="Space Grotesk for headings, Inter for body and interface, JetBrains Mono for code and logs, Bricolage Grotesque for brand moments only."
        >
          <div className="divide-y divide-border rounded-lg border border-border bg-card">
            {TYPE_SCALE.map((row) => (
              <div
                key={row.token}
                className="grid gap-2 px-4 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6"
              >
                <div className="font-mono text-muted-foreground text-xs leading-relaxed">
                  <p className="text-foreground">{row.token}</p>
                  <p>
                    {row.font.replace("--font-", "")} · {row.weight}
                  </p>
                  <p>
                    {row.size} / {row.lineHeight}
                  </p>
                </div>
                <p
                  className="min-w-0 break-words"
                  style={{
                    fontFamily: `var(${row.font})`,
                    fontWeight: row.weight,
                    fontSize: row.size,
                    lineHeight: row.lineHeight,
                    ...row.extra,
                  }}
                >
                  {row.sample}
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="components"
          title="Components"
          intro="The shadcn/ui parts the dashboard uses, styled only by the theme."
        >
          <div className="grid grid-cols-[minmax(0,1fr)] gap-10">
            <div>
              <h3
                className="mb-3 font-medium text-[17px]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Buttons
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                <Button>
                  <Rocket data-icon="inline-start" />
                  Deploy from GitHub
                </Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Delete service</Button>
                <Button variant="link">Link</Button>
                <Button disabled>Disabled</Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button size="xs">Extra small</Button>
                <Button size="sm">Small</Button>
                <Button>Default</Button>
                <Button size="lg">Large</Button>
              </div>
            </div>

            <div>
              <h3
                className="mb-3 font-medium text-[17px]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Status badges
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                {STATUSES.map((status) => (
                  <StatusBadge key={status} status={status} />
                ))}
              </div>
              <p className="mt-3 text-muted-foreground text-sm">
                The dashboard's own <code className="font-mono text-foreground">StatusBadge</code>.
                Building and deploying pulse. Superseded shows as{" "}
                {STATUS_STYLES.superseded.label.toLowerCase()} in canceled's colour.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="destructive">Destructive</Badge>
              </div>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <h3
                  className="mb-3 font-medium text-[17px]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Card
                </h3>
                <Card>
                  <CardHeader>
                    <CardTitle>web</CardTitle>
                    <CardDescription>github.com/lift-demo/next-hello · main</CardDescription>
                    <CardAction>
                      <StatusBadge status="active" />
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    <p className="font-mono text-muted-foreground text-xs">
                      https://next-hello.apps.trylift.dev
                    </p>
                  </CardContent>
                  <CardFooter className="justify-between">
                    <span className="text-muted-foreground text-xs">Deployed 2 min ago</span>
                    <Button size="sm" variant="outline">
                      View logs
                    </Button>
                  </CardFooter>
                </Card>
              </div>

              <div>
                <h3
                  className="mb-3 font-medium text-[17px]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Input
                </h3>
                <div className="grid gap-4 rounded-xl border border-border bg-card p-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="sg-repo">Repository</Label>
                    <Input id="sg-repo" placeholder="github.com/you/your-app" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="sg-port">Port</Label>
                    <Input
                      id="sg-port"
                      defaultValue="80800"
                      aria-invalid="true"
                      aria-describedby="sg-port-error"
                    />
                    <p id="sg-port-error" className="text-destructive text-xs">
                      Ports go up to 65535. Try 8080.
                    </p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="sg-disabled">Region</Label>
                    <Input id="sg-disabled" defaultValue="eu-west-1" disabled />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h3
                className="mb-3 font-medium text-[17px]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Tabs and table
              </h3>
              <Tabs defaultValue="deployments">
                <TabsList>
                  <TabsTrigger value="deployments">Deployments</TabsTrigger>
                  <TabsTrigger value="variables">Variables</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="deployments" className="min-w-0">
                  <div className="overflow-x-auto rounded-lg border border-border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Commit</TableHead>
                          <TableHead>Message</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">When</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {DEPLOYMENTS.map((deployment) => (
                          <TableRow key={deployment.sha}>
                            <TableCell className="font-mono text-xs">{deployment.sha}</TableCell>
                            <TableCell>{deployment.message}</TableCell>
                            <TableCell>
                              <StatusBadge status={deployment.status} />
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground tabular-nums">
                              {deployment.when}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
                <TabsContent value="variables">
                  <p className="rounded-lg border border-border bg-card p-4 font-mono text-sm">
                    DATABASE_URL = ••••••••
                  </p>
                </TabsContent>
                <TabsContent value="settings">
                  <p className="rounded-lg border border-border bg-card p-4 text-muted-foreground">
                    Service settings go here.
                  </p>
                </TabsContent>
              </Tabs>
            </div>

            <div>
              <h3
                className="mb-3 font-medium text-[17px]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Dialog
              </h3>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <RotateCcw data-icon="inline-start" />
                    Roll back
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Roll back to a1b2c3d?</DialogTitle>
                    <DialogDescription>
                      Lift redeploys this commit's image. The current deployment keeps running until
                      the old one is live.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button>Roll back</Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}
