import type { LogStream } from "../enums";
import { LogEntry } from "../schemas/logs";
import { fixtureCommits, fixtureHex, fixtureIds } from "./ids";

/** [milliseconds after the start, stream, text] */
type Line = readonly [number, LogStream, string];

/** Turns lines into entries with Redis Stream IDs (`{ms}-{seq}`) and ISO timestamps. */
function render(startIso: string, lines: readonly Line[]): LogEntry[] {
  const start = Date.parse(startIso);
  let previous = -1;
  let sequence = 0;
  return lines.map(([offset, stream, line]) => {
    const ms = start + offset;
    sequence = ms === previous ? sequence + 1 : 0;
    previous = ms;
    return LogEntry.parse({
      id: `${ms}-${sequence}`,
      ts: new Date(ms).toISOString(),
      stream,
      line,
    });
  });
}

// ANSI colours, as Railpack, npm and Next.js print them; the log viewer renders them.
const ESC = "\u001b[";
const bold = (text: string) => `${ESC}1m${text}${ESC}22m`;
const green = (text: string) => `${ESC}32m${text}${ESC}39m`;
const yellow = (text: string) => `${ESC}33m${text}${ESC}39m`;
const red = (text: string) => `${ESC}31m${text}${ESC}39m`;
const magenta = (text: string) => `${ESC}35m${text}${ESC}39m`;

interface BuildInfo {
  repo: string;
  sha: string;
  message: string;
  serviceId: string;
  deploymentId: string;
  node: string;
  nodeSource: string;
}

const builderImage = `ghcr.io/railwayapp/railpack-builder:latest@sha256:${fixtureHex("builder", 64)}`;
const runtimeImage = `ghcr.io/railwayapp/railpack-runtime:latest@sha256:${fixtureHex("runtime", 64)}`;

/** Clone, Railpack's plan and BuildKit up to `npm ci`: the same for every Next.js build here. */
function setup(b: BuildInfo, startedNpm: number): Line[] {
  const short = b.sha.slice(0, 7);
  return [
    [0, "system", `Building ${b.repo} at ${short}: "${b.message}"`],
    [180, "system", `Cloning ${b.repo} at ${short}`],
    [1360, "system", "Cloned in 1.2s"],
    [1420, "system", "Detected Next.js 16 (npm). Building with Railpack."],
    [1650, "build", ""],
    [1650, "build", "╭─────────────────╮"],
    [1650, "build", "│ Railpack 0.15.1 │"],
    [1650, "build", "╰─────────────────╯"],
    [1651, "build", ""],
    [1651, "build", ` ${magenta("↳")} Detected Node`],
    [1651, "build", ` ${magenta("↳")} Detected Next.js`],
    [1651, "build", ` ${magenta("↳")} Using npm package manager`],
    [1651, "build", ` ${magenta("↳")} Found web command in package.json`],
    [1652, "build", ""],
    [1652, "build", bold(" Packages")],
    [1652, "build", " ──────────"],
    [1652, "build", ` node  │  ${b.node}  │  ${b.nodeSource}`],
    [1653, "build", ""],
    [1653, "build", bold(" Steps")],
    [1653, "build", " ──────────"],
    [1653, "build", ` ${magenta("▸")} install`],
    [1653, "build", "   $ npm ci"],
    [1654, "build", ""],
    [1654, "build", ` ${magenta("▸")} build`],
    [1654, "build", "   $ npm run build"],
    [1655, "build", ""],
    [1655, "build", bold(" Deploy")],
    [1655, "build", " ──────────"],
    [1655, "build", "   $ npm run start"],
    [1656, "build", ""],
    [1900, "build", '#0 building with "default" instance using remote driver'],
    [1910, "build", ""],
    [1920, "build", "#1 [internal] load build definition from railpack-plan.json"],
    [1940, "build", "#1 transferring dockerfile: 4.12kB done"],
    [1950, "build", "#1 DONE 0.0s"],
    [1960, "build", ""],
    [2100, "build", "#2 [internal] load metadata for ghcr.io/railwayapp/railpack-builder:latest"],
    [2110, "build", "#3 [internal] load metadata for ghcr.io/railwayapp/railpack-runtime:latest"],
    [2700, "build", "#2 DONE 0.6s"],
    [2710, "build", "#3 DONE 0.6s"],
    [2720, "build", ""],
    [2730, "build", "#4 [internal] load .dockerignore"],
    [2740, "build", "#4 transferring context: 2B done"],
    [2750, "build", "#4 DONE 0.0s"],
    [2760, "build", ""],
    [2770, "build", "#5 [internal] load build context"],
    [2900, "build", "#5 transferring context: 418.27kB 0.1s done"],
    [2910, "build", "#5 DONE 0.1s"],
    [2920, "build", ""],
    [2930, "build", `#6 [builder 1/1] FROM ${builderImage}`],
    [2940, "build", `#6 resolve ${builderImage} 0.0s done`],
    [2950, "build", "#6 CACHED"],
    [2960, "build", ""],
    [2970, "build", `#7 [runtime 1/1] FROM ${runtimeImage}`],
    [2980, "build", `#7 resolve ${runtimeImage} 0.0s done`],
    [2990, "build", "#7 CACHED"],
    [3000, "build", ""],
    [3010, "build", `#8 [install 1/3] RUN mise install node@${b.node}`],
    [3520, "build", `#8 0.512 mise node@${b.node}  download node-v${b.node}-linux-x64.tar.xz`],
    [4890, "build", `#8 1.876 mise node@${b.node}  checksum node-v${b.node}-linux-x64.tar.xz`],
    [6210, "build", `#8 3.204 mise node@${b.node}  extract node-v${b.node}-linux-x64.tar.xz`],
    [8880, "build", `#8 5.874 mise node@${b.node}  node -v`],
    [8890, "build", `#8 5.881 v${b.node}`],
    [8900, "build", `#8 5.890 mise node@${b.node} ${green("✓")} installed`],
    [9110, "build", "#8 DONE 6.1s"],
    [9120, "build", ""],
    [9130, "build", "#9 [install 2/3] COPY package.json package-lock.json ./"],
    [9180, "build", "#9 DONE 0.0s"],
    [9190, "build", ""],
    [
      startedNpm,
      "build",
      "#10 [install 3/3] RUN --mount=type=cache,id=npm,target=/root/.npm npm ci",
    ],
  ];
}

const npmWarn = yellow("npm warn");
const deprecations = [
  "inflight@1.0.6: This module is not supported, and leaks memory. Do not use it.",
  "glob@7.2.3: Glob versions prior to v9 are no longer supported",
  "rimraf@3.0.2: Rimraf versions prior to v4 are no longer supported",
  "@humanwhocodes/object-schema@2.0.3: Use @eslint/object-schema instead",
  "@humanwhocodes/config-array@0.13.0: Use @eslint/config-array instead",
];

const routes = [
  "┌ ○ /                                     5.21 kB         114 kB",
  "├ ○ /_not-found                             993 B         103 kB",
  "├ ○ /about                                  1.4 kB         104 kB",
  "├ ƒ /api/cart                                136 B         102 kB",
  "├ ƒ /api/checkout                            136 B         102 kB",
  "├ ƒ /api/health                              136 B         102 kB",
  "├ ƒ /api/products                            136 B         102 kB",
  "├ ○ /cart                                  3.87 kB         112 kB",
  "├ ƒ /checkout                              4.66 kB         113 kB",
  "├ ○ /contact                               1.21 kB         104 kB",
  "├ ○ /faq                                   2.02 kB         105 kB",
  "├ ○ /products                              4.12 kB         113 kB",
  "├ ● /products/[slug]                       2.95 kB         111 kB",
  "├   ├ /products/canvas-tote",
  "├   ├ /products/linen-shirt",
  "├   ├ /products/ceramic-mug",
  "├   └ [+3 more paths]",
  "├ ○ /robots.txt                              136 B         102 kB",
  "└ ○ /sitemap.xml                             136 B         102 kB",
  "+ First Load JS shared by all               102 kB",
  "  ├ chunks/255-4efd16fd8bd3e5b1.js         46.1 kB",
  "  ├ chunks/4bd1b696-c49c6f2d40a1e5c6.js    54.2 kB",
  "  └ other shared chunks (total)            1.89 kB",
  "",
  "",
  "○  (Static)   prerendered as static content",
  "●  (SSG)      prerendered as static HTML (uses generateStaticParams)",
  "ƒ  (Dynamic)  server-rendered on demand",
  "",
];

interface DeployInfo {
  serviceSlug: string;
  serviceId: string;
  deploymentId: string;
  previousDeploymentId: string;
  projectId: string;
  hostname: string;
  port: number;
  healthcheckPath: string;
}

/** A successful Railpack build of a Next.js app, then the deploy: about 200 lines. */
function successfulBuild(b: BuildInfo, d: DeployInfo): Line[] {
  const image = `lift/${b.serviceId}:${b.deploymentId}`;
  const lines: Line[] = setup(b, 9200);
  deprecations.forEach((text, i) => {
    lines.push([
      11_314 + i * 60,
      "build",
      `#10 ${(2.114 + i * 0.06).toFixed(3)} ${npmWarn} deprecated ${text}`,
    ]);
  });
  lines.push(
    [24_002, "build", "#10 14.802 "],
    [24_003, "build", "#10 14.802 added 342 packages, and audited 343 packages in 15s"],
    [24_004, "build", "#10 14.803 "],
    [24_005, "build", "#10 14.803 148 packages are looking for funding"],
    [24_006, "build", "#10 14.803   run `npm fund` for details"],
    [24_011, "build", "#10 14.811 "],
    [24_012, "build", "#10 14.811 found 0 vulnerabilities"],
    [24_020, "build", "#10 14.820 npm notice"],
    [24_021, "build", "#10 14.820 npm notice New minor version of npm available! 10.9.4 -> 10.9.7"],
    [24_022, "build", "#10 14.820 npm notice To update run: npm install -g npm@10.9.7"],
    [24_023, "build", "#10 14.820 npm notice"],
    [24_500, "build", "#10 DONE 15.3s"],
    [24_510, "build", ""],
    [24_520, "build", "#11 [build 1/2] COPY . ."],
    [24_640, "build", "#11 DONE 0.1s"],
    [24_650, "build", ""],
    [
      24_660,
      "build",
      "#12 [build 2/2] RUN --mount=type=cache,id=next,target=/app/.next/cache npm run build",
    ],
    [25_062, "build", "#12 0.402 "],
    [25_063, "build", "#12 0.402 > next-hello@0.4.0 build"],
    [25_064, "build", "#12 0.402 > next build"],
    [25_065, "build", "#12 0.402 "],
    [
      25_981,
      "build",
      "#12 0.981 Attention: Next.js now collects completely anonymous telemetry regarding usage.",
    ],
    [
      25_982,
      "build",
      "#12 0.981 This information is used to shape Next.js' roadmap and prioritize features.",
    ],
    [
      25_983,
      "build",
      "#12 0.981 You can learn more, including how to opt-out if you'd not like to participate in this anonymous program, by visiting the following URL:",
    ],
    [25_984, "build", "#12 0.981 https://nextjs.org/telemetry"],
    [25_985, "build", "#12 0.981 "],
    [26_271, "build", `#12 1.611    ${bold(`${magenta("▲")} Next.js 16.0.3`)}`],
    [26_272, "build", "#12 1.612    - Experiments (use with caution):"],
    [26_273, "build", "#12 1.612      · typedRoutes"],
    [26_274, "build", "#12 1.612 "],
    [26_293, "build", "#12 1.633    Creating an optimized production build ..."],
    [49_607, "build", `#12 24.947  ${green("✓")} Compiled successfully in 22.8s`],
    [49_615, "build", "#12 24.955    Linting and checking validity of types ..."],
    [55_870, "build", "#12 31.210    Collecting page data ..."],
    [57_664, "build", "#12 33.004    Generating static pages (0/14) ..."],
    [58_010, "build", "#12 33.350    Generating static pages (3/14) "],
    [58_431, "build", "#12 33.771    Generating static pages (6/14) "],
    [58_893, "build", "#12 34.233    Generating static pages (10/14) "],
    [59_472, "build", `#12 34.812  ${green("✓")} Generating static pages (14/14)`],
    [60_058, "build", "#12 35.398    Finalizing page optimization ..."],
    [60_062, "build", "#12 35.402    Collecting build traces ..."],
    [66_277, "build", "#12 41.617 "],
    [
      66_302,
      "build",
      "#12 41.642 Route (app)                                  Size  First Load JS",
    ],
  );
  routes.forEach((route, i) => {
    lines.push([66_303 + i, "build", `#12 41.643 ${route}`]);
  });
  const layer = (label: string) => `sha256:${fixtureHex(`${b.deploymentId}:${label}`, 64)}`;
  lines.push(
    [67_100, "build", "#12 DONE 42.4s"],
    [67_110, "build", ""],
    [
      67_120,
      "build",
      "#13 [runtime 1/5] COPY --from=install /root/.local/share/mise /root/.local/share/mise",
    ],
    [68_320, "build", "#13 DONE 1.2s"],
    [68_330, "build", ""],
    [68_340, "build", "#14 [runtime 2/5] COPY --from=install /etc/mise /etc/mise"],
    [68_350, "build", "#14 DONE 0.0s"],
    [68_360, "build", ""],
    [68_370, "build", "#15 [runtime 3/5] COPY --from=build /app/node_modules /app/node_modules"],
    [72_170, "build", "#15 DONE 3.8s"],
    [72_180, "build", ""],
    [72_190, "build", "#16 [runtime 4/5] COPY --from=build /app/.next /app/.next"],
    [73_090, "build", "#16 DONE 0.9s"],
    [73_100, "build", ""],
    [
      73_110,
      "build",
      "#17 [runtime 5/5] COPY --from=build /app/public /app/package.json /app/next.config.ts /app/",
    ],
    [73_210, "build", "#17 DONE 0.1s"],
    [73_220, "build", ""],
    [73_230, "build", "#18 exporting to image"],
    [73_240, "build", "#18 exporting layers"],
    [81_640, "build", "#18 exporting layers 8.4s done"],
    [81_660, "build", `#18 exporting manifest ${layer("manifest")} 0.0s done`],
    [81_680, "build", `#18 exporting config ${layer("config")} 0.0s done`],
    [81_700, "build", `#18 writing image ${layer("image")} done`],
    [81_710, "build", `#18 naming to docker.io/${image} done`],
    [81_720, "build", "#18 DONE 8.5s"],
    [81_730, "build", ""],
    [81_740, "build", "#19 exporting cache to client directory"],
    [81_750, "build", "#19 preparing build cache for export"],
    [82_050, "build", `#19 writing layer ${layer("cache-1")} 0.3s done`],
    [83_150, "build", `#19 writing layer ${layer("cache-2")} 1.1s done`],
    [84_310, "build", `#19 writing layer ${layer("cache-3")} 1.2s done`],
    [84_340, "build", `#19 writing config ${layer("cache-config")} done`],
    [84_350, "build", "#19 DONE 2.6s"],
    [84_360, "build", ""],
    [84_370, "build", "#20 resolving provenance for metadata file"],
    [84_380, "build", "#20 DONE 0.0s"],
    [123_000, "system", "Image built in 2m 03s"],
    ...deploy(d, image, 123_100),
  );
  return lines;
}

/** Starting the container, the health check and the swap. */
function deploy(d: DeployInfo, image: string, at: number): Line[] {
  const container = (id: string) => `lift-${d.serviceSlug}-${id.slice(-6)}`;
  return [
    [at, "deploy", `Image ${image} is on this machine; no pull needed`],
    [at + 200, "deploy", `Creating container ${container(d.deploymentId)}`],
    [at + 220, "deploy", `Networks: lift-edge, lift-prj-${d.projectId} (alias ${d.serviceSlug})`],
    [at + 230, "deploy", "Limits: 0.5 vCPU, 512 MB memory and swap, 256 processes"],
    [at + 240, "deploy", `Routing ${d.hostname} to port ${d.port}`],
    [at + 1_000, "deploy", "Starting container"],
    [
      at + 1_800,
      "deploy",
      `Checking http://172.18.0.7:${d.port}${d.healthcheckPath} every 2s, for up to 120s`,
    ],
    [at + 3_800, "deploy", "Health check: connection refused, retrying"],
    [at + 5_800, "deploy", "Health check passed: 200 OK in 38 ms"],
    [at + 5_850, "deploy", "Reported active to the control plane"],
    [at + 5_900, "system", `Deployment is live at http://${d.hostname}`],
    [
      at + 5_950,
      "deploy",
      `The previous deployment (${d.previousDeploymentId}) keeps serving for 10s`,
    ],
    [at + 15_950, "deploy", `Removing ${container(d.previousDeploymentId)}`],
    [at + 16_000, "deploy", `Stopped and removed ${container(d.previousDeploymentId)}`],
  ];
}

/** A Next.js 16 build on Node 18: what autofix fixes by setting NODE_VERSION=22. */
function nodeVersionFailure(b: BuildInfo): Line[] {
  const lines: Line[] = setup(b, 9200);
  const engine = [
    "Unsupported engine {",
    "  package: 'next@16.0.3',",
    "  required: { node: '>=20.9.0' },",
    "  current: { node: 'v18.20.4', npm: '10.7.0' }",
    "}",
  ];
  engine.forEach((text, i) => {
    lines.push([11_102 + i, "build", `#10 1.902 ${npmWarn} EBADENGINE ${text}`]);
  });
  const failure =
    'process "/bin/bash -ol pipefail -c npm run build" did not complete successfully: exit code: 1';
  const nodeError =
    'You are using Node.js 18.20.4. For Next.js, Node.js version ">=20.9.0" is required.';
  lines.push(
    [26_402, "build", "#10 17.202 added 342 packages, and audited 343 packages in 17s"],
    [26_410, "build", "#10 17.210 found 0 vulnerabilities"],
    [26_900, "build", "#10 DONE 17.7s"],
    [26_910, "build", ""],
    [26_920, "build", "#11 [build 1/2] COPY . ."],
    [27_040, "build", "#11 DONE 0.1s"],
    [27_050, "build", ""],
    [
      27_060,
      "build",
      "#12 [build 2/2] RUN --mount=type=cache,id=next,target=/app/.next/cache npm run build",
    ],
    [27_451, "build", "#12 0.391 "],
    [27_452, "build", "#12 0.391 > next-hello@0.4.0 build"],
    [27_453, "build", "#12 0.391 > next build"],
    [27_454, "build", "#12 0.391 "],
    [27_572, "build", `#12 0.512 ${nodeError}`],
    [27_690, "build", `#12 ${red("ERROR")}: ${failure}`],
    [27_700, "build", "------"],
    [
      27_701,
      "build",
      " > [build 2/2] RUN --mount=type=cache,id=next,target=/app/.next/cache npm run build:",
    ],
    [27_702, "build", "0.391 > next-hello@0.4.0 build"],
    [27_703, "build", "0.391 > next build"],
    [27_704, "build", `0.512 ${nodeError}`],
    [27_705, "build", "------"],
    [27_710, "build", `${red("ERROR")}: failed to solve: ${failure}`],
    [66_000, "system", "Build failed after 1m 06s: npm run build exited with code 1"],
  );
  return lines;
}

const { services, deployments: deps, project } = fixtureIds;

/** The web service's active deployment: built by autofix after it set NODE_VERSION=22. */
export const buildLog = render(
  "2026-11-17T14:18:02.000Z",
  successfulBuild(
    {
      repo: "lift-demo/next-hello",
      ...fixtureCommits.webGrid,
      serviceId: services.web,
      deploymentId: deps.webActive,
      node: "22.21.1",
      nodeSource: "NODE_VERSION variable (22)",
    },
    {
      serviceSlug: "web",
      serviceId: services.web,
      deploymentId: deps.webActive,
      previousDeploymentId: deps.webFirst,
      projectId: project,
      hostname: "web-demo-shop.apps.localhost",
      port: 3000,
      healthcheckPath: "/",
    },
  ),
);

/** The failed deployment before it: Next.js 16 refuses Node 18. */
export const failedBuildLog = render(
  "2026-11-17T14:05:02.000Z",
  nodeVersionFailure({
    repo: "lift-demo/next-hello",
    ...fixtureCommits.webGrid,
    serviceId: services.web,
    deploymentId: deps.webFailed,
    node: "18.20.4",
    nodeSource: "package.json engines.node (18.x)",
  }),
);

/** The editor deployment, still building: the first 72 lines of a build. */
const inProgressLog = render(
  "2026-11-18T08:41:02.000Z",
  successfulBuild(
    {
      repo: "lift-demo/next-hello",
      ...fixtureCommits.webHero,
      serviceId: services.web,
      deploymentId: deps.webBuilding,
      node: "22.21.1",
      nodeSource: "NODE_VERSION variable (22)",
    },
    {
      serviceSlug: "web",
      serviceId: services.web,
      deploymentId: deps.webBuilding,
      previousDeploymentId: deps.webActive,
      projectId: project,
      hostname: "web-demo-shop.apps.localhost",
      port: 3000,
      healthcheckPath: "/",
    },
  ).slice(0, 72),
);

/** The rollback, still deploying: no build, the earlier image starts again. */
const rollbackLog = render("2026-11-18T08:43:00.000Z", [
  [0, "system", `Rolling back to ${deps.apiFirst}: reusing its image, no build`],
  ...deploy(
    {
      serviceSlug: "api",
      serviceId: services.api,
      deploymentId: deps.apiRollback,
      previousDeploymentId: deps.apiActive,
      projectId: project,
      hostname: "api-demo-shop.apps.localhost",
      port: 8080,
      healthcheckPath: "/health",
    },
    `lift/${services.api}:${deps.apiFirst}`,
    150,
  ).slice(0, 7),
]);

/** Build and deploy logs by deployment ID; deployments that never started have none. */
export const deploymentLogs: Record<string, LogEntry[]> = {
  [deps.webActive]: buildLog,
  [deps.webFailed]: failedBuildLog,
  [deps.webBuilding]: inProgressLog,
  [deps.apiRollback]: rollbackLog,
};
