"use client";

import { DeploymentStatus } from "@lift/shared";
import { Rocket, RotateCcw } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { StatusBadge } from "@/components/status-badge";
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
import { cn } from "@/lib/utils";
import { contrastRatio, parseRgb, type Rgb, toHex } from "./contrast";

type Mode = "dark" | "light";
type ZoneId = "general" | "ground" | "atmosphere" | "orbit";

/** The brand kit's four zones. Ground, Atmosphere and Orbit are classes from theme.css. */
const ZONES: {
  id: ZoneId;
  name: string;
  className: string;
  where: string;
  light: string;
  dark: string;
  personality: string;
}[] = [
  {
    id: "general",
    name: "General",
    className: "",
    where: "App shell, Projects, sign-in, landing page",
    light: "Light",
    dark: "Dark",
    personality: "The full voice. Bold headings, and Bricolage Grotesque for brand moments.",
  },
  {
    id: "ground",
    name: "Ground",
    className: "zone-ground",
    where: "The live editor: writing, building, collaborating",
    light: "Morning",
    dark: "Sunset",
    personality: "Quietest weights and generous spacing, for reading for hours. No Expressive.",
  },
  {
    id: "atmosphere",
    name: "Atmosphere",
    className: "zone-atmosphere",
    where: "The AI: plans, diagnoses, the ops chat",
    light: "Day",
    dark: "Twilight",
    personality: "Medium weight, slightly looser tracking: conversational rather than declarative.",
  },
  {
    id: "orbit",
    name: "Orbit",
    className: "zone-orbit",
    where: "Deployments, logs and services: live and monitored",
    light: "Nebula",
    dark: "Void",
    personality: "Bold, tight-tracked caps for labels. Precise, never cute. No Expressive.",
  },
];

/** Every palette in the brand kit, complete and in the kit's order. Shared colours appear in each. */
const PALETTE: { title: string; colours: string[] }[] = [
  {
    title: "General · light",
    colours: [
      "frost",
      "architectural-cream",
      "coral-kiss",
      "nebula-purple",
      "sunlit-amber",
      "cobalt-sky",
    ],
  },
  {
    title: "General · dark",
    colours: [
      "deep-space",
      "aubergine",
      "coral-kiss",
      "nebula-purple",
      "sunlit-amber",
      "electric-cyan",
    ],
  },
  {
    title: "Ground · Morning",
    colours: [
      "linen-beige",
      "dawn-lavender",
      "sky-wash",
      "moss-green",
      "pistachio",
      "rosy-brown",
      "architectural-cream",
      "frosted-mint",
    ],
  },
  {
    title: "Ground · Sunset",
    colours: [
      "rain-boots",
      "heat-marker",
      "madder-lake",
      "claret",
      "aubergine",
      "dark-green",
      "prussian-blue",
      "stormy-teal",
      "shadow-grey",
    ],
  },
  {
    title: "Atmosphere · Day",
    colours: [
      "cobalt-sky",
      "electric-cyan",
      "icy-aqua",
      "sky-blue",
      "iced-denim",
      "frost",
      "deep-azure",
    ],
  },
  {
    title: "Atmosphere · Twilight",
    colours: [
      "vivid-indigo",
      "twilight-violet",
      "moonlit-lilac",
      "deep-azure",
      "atmospheric-blue",
      "electric-cyan",
      "shadow-grey",
    ],
  },
  {
    title: "Orbit · Nebula",
    colours: [
      "nebula-purple",
      "orchid-dream",
      "deep-violet",
      "coral-kiss",
      "signal-red",
      "tangerine-tide",
      "sunlit-amber",
      "starlight-gold",
      "electric-teal",
      "deep-space",
    ],
  },
  {
    title: "Orbit · Void",
    colours: [
      "midnight-nebula",
      "shadow-orchid",
      "void-indigo",
      "dusk-rose",
      "ember-red",
      "burnt-tangerine",
      "aged-gold",
      "starlight-gold",
      "abyssal-teal",
      "deep-space",
    ],
  },
];

/** More of the palette at work, beyond surfaces and statuses. 3:1 against every surface. */
const PALETTE_AT_WORK: { title: string; note: string; tokens: [string, string][] }[] = [
  {
    title: "Collaborator cursors",
    note: "Each person in the live editor gets one, with their name on a flag.",
    tokens: Array.from({ length: 8 }, (_, index) => [
      `presence-${index + 1}`,
      `Person ${index + 1}`,
    ]),
  },
  {
    title: "Deployment triggers",
    note: "The icon on each row of the deployments list. Agent takes Atmosphere's colour, editor takes Ground's.",
    tokens: ["push", "manual", "rollback", "agent", "editor", "cli"].map((name) => [
      `trigger-${name}`,
      name === "cli" ? "CLI" : title(name),
    ]),
  },
  {
    title: "Log streams",
    note: "The faint label at the start of each log line.",
    tokens: ["build", "deploy", "runtime", "system"].map((name) => [`log-${name}`, title(name)]),
  },
  {
    title: "Variable sources",
    note: "Who set each variable.",
    tokens: [
      ["source-you", "You"],
      ["source-database", "Database"],
      ["source-agent", "Agent"],
    ],
  },
  {
    title: "Databases",
    note: "The type icon on database cards.",
    tokens: [
      ["db-postgres", "Postgres"],
      ["db-redis", "Redis"],
    ],
  },
];

const STATUSES = DeploymentStatus.options.filter((status) => status !== "superseded");

const ROLE_GROUPS: { title: string; tokens: string[] }[] = [
  {
    title: "Surfaces",
    tokens: ["background", "card", "muted", "accent", "border", "input"],
  },
  {
    title: "Text and actions",
    tokens: [
      "foreground",
      "muted-foreground",
      "primary",
      "primary-foreground",
      "destructive",
      "ring",
    ],
  },
  { title: "Status", tokens: STATUSES.map((status) => `status-${status}`) },
  { title: "Charts", tokens: ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] },
];

/** Text on a surface: 4.5:1 (WCAG AA). */
const TEXT_PAIRS: [string, string][] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["foreground", "muted"],
  ["foreground", "accent"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["muted-foreground", "muted"],
  ["primary-foreground", "primary"],
  ["primary", "background"],
  ["primary", "card"],
  ["destructive", "background"],
  ["destructive", "card"],
];

/** Non-text marks (status dots, focus rings): 3:1 (WCAG 1.4.11). */
const MARK_PAIRS: [string, string][] = [
  ...STATUSES.flatMap((status) =>
    (["background", "card", "muted"] as const).map(
      (surface) => [`status-${status}`, surface] as [string, string],
    ),
  ),
  ["ring", "background"],
  ["ring", "card"],
  ...PALETTE_AT_WORK.flatMap((group) =>
    group.tokens.flatMap(
      ([token]) =>
        [
          [token, "background"],
          [token, "card"],
        ] as [string, string][],
    ),
  ),
];

const TOKENS = [
  ...new Set([
    ...ROLE_GROUPS.flatMap((group) => group.tokens),
    ...PALETTE_AT_WORK.flatMap((group) => group.tokens.map(([token]) => token)),
    ...TEXT_PAIRS.flat(),
    ...MARK_PAIRS.flat(),
    ...PALETTE.flatMap((group) => group.colours.map((name) => `lift-${name}`)),
  ]),
];

const TYPE_SCALE: {
  token: string;
  font: string;
  weight: string;
  size: string;
  lineHeight: number;
  sample: string;
  extra?: CSSProperties;
}[] = [
  {
    token: "display",
    font: "--font-display",
    weight: "700",
    size: "48px",
    lineHeight: 1.1,
    sample: "Ground to Orbit.",
  },
  {
    token: "h1",
    font: "--font-display",
    weight: "var(--heading-weight)",
    size: "32px",
    lineHeight: 1.2,
    sample: "Your projects",
    extra: { letterSpacing: "var(--heading-tracking)" },
  },
  {
    token: "h2",
    font: "--font-display",
    weight: "var(--heading-weight)",
    size: "22px",
    lineHeight: 1.25,
    sample: "Deployments",
    extra: { letterSpacing: "var(--heading-tracking)" },
  },
  {
    token: "h3",
    font: "--font-display",
    weight: "500",
    size: "17px",
    lineHeight: 1.3,
    sample: "Environment variables",
  },
  {
    token: "body",
    font: "--font-sans",
    weight: "400",
    size: "15px",
    lineHeight: 1.6,
    sample: "Paste a repo. The AI plans the deployment, and it's live at its own HTTPS address.",
  },
  {
    token: "body-sm",
    font: "--font-sans",
    weight: "400",
    size: "13px",
    lineHeight: 1.5,
    sample: "Last deployed 4 minutes ago from main.",
  },
  {
    token: "ui",
    font: "--font-sans",
    weight: "500",
    size: "14px",
    lineHeight: 1.4,
    sample: "Deploy from GitHub",
  },
  {
    token: "label",
    font: "--font-sans",
    weight: "600",
    size: "11px",
    lineHeight: 1.2,
    sample: "Build logs",
    extra: { textTransform: "uppercase", letterSpacing: "0.04em" },
  },
  {
    token: "mono",
    font: "--font-mono",
    weight: "450",
    size: "13px",
    lineHeight: 1.6,
    sample: "$ lift up  →  live at myapp.trylift.dev  (a1b2c3d, 0Ol1I)",
  },
  {
    token: "expressive",
    font: "--font-expressive",
    weight: "800",
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

const headingStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: "var(--heading-weight)" as CSSProperties["fontWeight"],
  letterSpacing: "var(--heading-tracking)",
};

/** A zone's headline: Bricolage in General and Atmosphere, Space Grotesk in Ground and Orbit. */
const zoneDisplayStyle: CSSProperties = {
  fontFamily: "var(--zone-display-font)",
  fontWeight: "var(--heading-weight)" as CSSProperties["fontWeight"],
  letterSpacing: "var(--heading-tracking)",
  textTransform: "var(--label-case)" as CSSProperties["textTransform"],
};

const labelStyle: CSSProperties = {
  textTransform: "var(--label-case)" as CSSProperties["textTransform"],
  letterSpacing: "0.04em",
};

/** Resolves a theme variable, inside `container`, to the colour the browser actually paints. */
function resolve(token: string, container: HTMLElement): Rgb | null {
  const probe = document.createElement("span");
  probe.style.color = `var(--${token})`;
  probe.style.display = "none";
  container.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return parseRgb(value);
}

/**
 * Previews light mode by taking the dark class off <html> (and puts it back on the way out), then
 * reads every token's painted colour inside the zone preview.
 */
function useThemeColours(
  mode: Mode,
  zone: ZoneId,
  container: RefObject<HTMLDivElement | null>,
): Record<string, Rgb | null> {
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
    // Read on the next frame, once the browser has applied the new classes. The zone is read from
    // the container's class, which React has already updated by now.
    const frame = requestAnimationFrame(() => {
      const element = container.current;
      if (!element || element.dataset.zone !== zone) return;
      setColours(Object.fromEntries(TOKENS.map((token) => [token, resolve(token, element)])));
    });
    return () => cancelAnimationFrame(frame);
  }, [mode, zone, container]);
  return colours;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="inline-flex flex-wrap rounded-lg border border-border bg-muted p-[3px]">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className="rounded-md px-3 py-1 font-medium text-muted-foreground text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-background aria-pressed:text-foreground"
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-border border-t pt-10">
      <h2 id={`${id}-title`} className="text-[22px] leading-tight" style={headingStyle}>
        {title}
      </h2>
      {intro ? <p className="mt-1 max-w-prose text-muted-foreground">{intro}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-3 text-[17px]" style={{ ...headingStyle, fontWeight: 500 }}>
      {children}
    </h3>
  );
}

function Swatch({
  token,
  label,
  rgb,
}: {
  token: string;
  label: string;
  rgb: Rgb | null | undefined;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <div className="h-14 border-border border-b" style={{ background: `var(--${token})` }} />
      <div className="px-2.5 py-2">
        <p className="truncate font-medium text-card-foreground text-xs">{label}</p>
        <p className="font-mono text-muted-foreground text-xs">{rgb ? toHex(rgb) : "…"}</p>
      </div>
    </div>
  );
}

function title(name: string): string {
  return name.replace(
    /(^|-)(\w)/g,
    (_, dash: string, letter: string) => `${dash ? " " : ""}${letter.toUpperCase()}`,
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

/** A small slice of the product in one zone: used for the side-by-side overview. */
function ZonePreview({ zone, mode }: { zone: (typeof ZONES)[number]; mode: Mode }) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-border p-4", zone.className)}>
      <p className="font-mono text-muted-foreground text-xs">
        {zone.name} · {mode === "dark" ? zone.dark : zone.light}
      </p>
      <p className="mt-2 text-[22px] leading-tight" style={zoneDisplayStyle}>
        {zone.name}
      </p>
      <p className="mt-1 text-muted-foreground text-sm">{zone.where}</p>
      <div className="mt-4 rounded-lg border border-border bg-card p-3 text-card-foreground">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm">web</span>
          <StatusBadge status="active" />
        </div>
        <p className="mt-1 truncate font-mono text-muted-foreground text-xs">a1b2c3d · main</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm">Deploy</Button>
          <Button size="sm" variant="outline">
            Logs
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {STATUSES.map((status) => (
          <StatusBadge key={status} status={status} />
        ))}
      </div>
    </div>
  );
}

export function StyleGuide() {
  const [mode, setMode] = useState<Mode>("dark");
  const [zoneId, setZoneId] = useState<ZoneId>("general");
  const zone = ZONES.find((item) => item.id === zoneId) ?? ZONES[0];
  const preview = useRef<HTMLDivElement>(null);
  const colours = useThemeColours(mode, zoneId, preview);
  const failures = [
    ...TEXT_PAIRS.map((pair) => [...pair, 4.5] as const),
    ...MARK_PAIRS.map((pair) => [...pair, 3] as const),
  ].filter(([fg, bg, min]) => {
    const a = colours[fg];
    const b = colours[bg];
    return a && b && contrastRatio(a, b) < min;
  });
  const zoneMode = mode === "dark" ? zone?.dark : zone?.light;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-border border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
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
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Zone"
              value={zoneId}
              onChange={setZoneId}
              options={ZONES.map((item) => ({ value: item.id, label: item.name }))}
            />
            <Segmented
              label="Mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-12 px-4 py-10 sm:px-6">
        <div className="max-w-2xl">
          <h1 className="text-[32px] leading-tight" style={headingStyle}>
            Lift's theme
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Ground → Atmosphere → Orbit, from the brand kit, read live from{" "}
            <code className="font-mono text-foreground text-sm">src/styles/theme.css</code>. Pick a
            zone and a mode at the top: everything from "Theme roles" down shows that zone.
          </p>
        </div>

        <Section
          id="zones"
          title="Four zones"
          intro={`Each zone is the same set of roles painted from its own palette. In ${mode} mode:`}
        >
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(4,minmax(0,1fr))]">
            {ZONES.map((item) => (
              <ZonePreview key={item.id} zone={item} mode={mode} />
            ))}
          </div>
          <p className="mt-4 text-muted-foreground text-sm">
            To put a screen in a zone, add its class to the screen's outer element:{" "}
            <code className="font-mono text-foreground">zone-ground</code>,{" "}
            <code className="font-mono text-foreground">zone-atmosphere</code> or{" "}
            <code className="font-mono text-foreground">zone-orbit</code>. No class means General.
          </p>
        </Section>

        <Section
          id="palette"
          title="Brand palette"
          intro="Every palette in the brand kit, complete, exactly as the kit groups them: 46 colours in all. These are the --lift-* variables; the themes are built only from them."
        >
          <div className="flex flex-col gap-8">
            {PALETTE.map((group) => (
              <div key={group.title}>
                <SubHeading>{group.title}</SubHeading>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                  {group.colours.map((name) => (
                    <Swatch
                      key={name}
                      token={`lift-${name}`}
                      label={title(name)}
                      rgb={colours[`lift-${name}`]}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <div
          ref={preview}
          data-zone={zoneId}
          className={cn("-mx-4 rounded-2xl px-4 py-2 sm:-mx-6 sm:px-6", zone?.className)}
        >
          <div className="flex flex-col gap-12">
            <div className="pt-8">
              <p className="font-mono text-muted-foreground text-xs" style={labelStyle}>
                Showing
              </p>
              <p className="mt-1 text-[32px] leading-tight" style={zoneDisplayStyle}>
                {zone?.name} · {zoneMode}
              </p>
              <p className="mt-1 max-w-prose text-muted-foreground">
                {zone?.where}. {zone?.personality}
              </p>
            </div>

            <Section
              id="roles"
              title="Theme roles"
              intro="What each role resolves to in this zone and mode."
            >
              <div className="flex flex-col gap-8">
                {ROLE_GROUPS.map((group) => (
                  <div key={group.title}>
                    <SubHeading>{group.title}</SubHeading>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                      {group.tokens.map((token) => (
                        <Swatch
                          key={token}
                          token={token}
                          label={`--${token}`}
                          rgb={colours[token]}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-muted-foreground text-sm">
                Status colours keep the same hue in every zone, so a status never changes meaning.
                Orbit's bright Tangerine page uses their deep Void siblings.
              </p>
            </Section>

            <Section
              id="palette-at-work"
              title="The palette at work"
              intro="More jobs for the kit's colours beyond surfaces and statuses. Each comes in a light and a dark set, and is checked in the contrast table below."
            >
              <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                {PALETTE_AT_WORK.map((group) => (
                  <div
                    key={group.title}
                    className="min-w-0 rounded-xl border border-border bg-card p-4 text-card-foreground"
                  >
                    <SubHeading>{group.title}</SubHeading>
                    <p className="-mt-2 mb-3 text-muted-foreground text-sm">{group.note}</p>
                    <div className="flex flex-wrap gap-2">
                      {group.tokens.map(([token, label]) =>
                        token.startsWith("presence-") ? (
                          <span
                            key={token}
                            className="inline-flex items-center gap-1 rounded-sm rounded-bl-none px-1.5 py-0.5 font-medium text-xs"
                            style={{ background: `var(--${token})`, color: "var(--background)" }}
                          >
                            {label}
                          </span>
                        ) : (
                          <span
                            key={token}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-xs"
                          >
                            <span
                              aria-hidden="true"
                              className="size-2.5 rounded-full"
                              style={{ background: `var(--${token})` }}
                            />
                            {label}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section
              id="contrast"
              title="Contrast"
              intro="Text needs 4.5:1 against what it sits on (WCAG AA). Status dots and focus rings need 3:1. Worked out live."
            >
              <p
                role="status"
                className={cn(
                  "mb-4 font-medium",
                  failures.length ? "text-destructive" : "text-foreground",
                )}
              >
                {failures.length
                  ? `${failures.length} pair${failures.length === 1 ? "" : "s"} below the minimum in ${zone?.name} · ${zoneMode}.`
                  : `Every pair passes in ${zone?.name} · ${zoneMode}.`}
              </p>
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
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
                      <ContrastRow
                        key={`${fg}-${bg}`}
                        fg={fg}
                        bg={bg}
                        min={4.5}
                        colours={colours}
                      />
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
              intro="Space Grotesk for headings, Inter for body and interface, JetBrains Mono for code and logs, Bricolage Grotesque for brand moments. Headings and labels take this zone's personality."
            >
              <div className="divide-y divide-border rounded-lg border border-border bg-card text-card-foreground">
                {TYPE_SCALE.map((row) => (
                  <div
                    key={row.token}
                    className="grid gap-2 px-4 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6"
                  >
                    <div className="font-mono text-muted-foreground text-xs leading-relaxed">
                      <p className="text-card-foreground">{row.token}</p>
                      <p>
                        {row.font.replace("--font-", "")} ·{" "}
                        {row.weight.startsWith("var") ? "zone weight" : row.weight}
                      </p>
                      <p>
                        {row.size} / {row.lineHeight}
                      </p>
                    </div>
                    <p
                      className="min-w-0 break-words"
                      style={{
                        fontFamily: `var(${row.font})`,
                        fontWeight: row.weight as CSSProperties["fontWeight"],
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
                  <SubHeading>Buttons</SubHeading>
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
                  <SubHeading>Status badges</SubHeading>
                  <div className="flex flex-wrap items-center gap-3">
                    {STATUSES.map((status) => (
                      <StatusBadge key={status} status={status} />
                    ))}
                  </div>
                  <p className="mt-3 text-muted-foreground text-sm">
                    The dashboard's own{" "}
                    <code className="font-mono text-foreground">StatusBadge</code>: always the name
                    next to its colour. Building and deploying pulse; superseded uses canceled's
                    colour.
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
                    <SubHeading>Card</SubHeading>
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
                    <SubHeading>Input</SubHeading>
                    <div className="grid gap-4 rounded-xl border border-border bg-card p-4 text-card-foreground">
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
                  <SubHeading>Tabs and table</SubHeading>
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
                              <TableHead style={labelStyle}>Commit</TableHead>
                              <TableHead style={labelStyle}>Message</TableHead>
                              <TableHead style={labelStyle}>Status</TableHead>
                              <TableHead className="text-right" style={labelStyle}>
                                When
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {DEPLOYMENTS.map((deployment) => (
                              <TableRow key={deployment.sha}>
                                <TableCell className="font-mono text-xs">
                                  {deployment.sha}
                                </TableCell>
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

                <div className="pb-10">
                  <SubHeading>Dialog</SubHeading>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline">
                        <RotateCcw data-icon="inline-start" />
                        Roll back
                      </Button>
                    </DialogTrigger>
                    <DialogContent className={zone?.className}>
                      <DialogHeader>
                        <DialogTitle>Roll back to a1b2c3d?</DialogTitle>
                        <DialogDescription>
                          Lift redeploys this commit's image. The current deployment keeps running
                          until the old one is live.
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
          </div>
        </div>
      </main>
    </div>
  );
}
