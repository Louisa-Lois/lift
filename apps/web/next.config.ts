import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// One .env at the repo root serves every app in development (pnpm env:init creates it).
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const apiUrl = process.env.API_URL ?? "http://localhost:4000";
const MONACO_API_FILE = "monaco-editor/esm/vs/editor/editor.api.js";

const nextConfig: NextConfig = {
  // packages/shared ships TypeScript source; Next compiles it along with the app.
  transpilePackages: ["@lift/shared"],

  turbopack: {
    resolveAlias: {
      // y-monaco 0.1.6 imports Monaco by a file path that monaco-editor 0.57's exports map no
      // longer serves; this is the same file under its exported path.
      [MONACO_API_FILE]: "monaco-editor/editor/editor.api.js",
    },
  },

  // The development proxy below cuts requests off after 30 s by default, and a plan may take up
  // to 60 s (POST /api/v1/agent/plans). Production doesn't use it: Traefik routes /api.
  experimental: { proxyTimeout: 70_000 },

  // In development the browser talks to one origin, so the session cookie just works.
  // In production Traefik sends /api to the API container instead.
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },

  // Security headers (docs/prd/02-frontend.md, "Non-functional"). A Content-Security-Policy
  // follows once the pages that load avatars, the collab WebSocket and Monaco exist.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
