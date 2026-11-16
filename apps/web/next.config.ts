import { existsSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// One .env at the repo root serves every app in development (pnpm env:init creates it).
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // packages/shared ships TypeScript source; Next compiles it along with the app.
  transpilePackages: ["@lift/shared"],

  // In development the browser talks to one origin, so the session cookie just works.
  // In production Traefik sends /api to the API container instead.
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
