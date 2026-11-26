import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Lift",
  description: "Deploy from GitHub, watch it run, let the AI fix it, and edit it together.",
  // Louisa's favicon (public/brand, UI-01): the SVG where browsers take one, a PNG elsewhere.
  icons: {
    icon: [
      { url: "/brand/favicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: { url: "/brand/favicon-180.png", sizes: "180x180", type: "image/png" },
  },
};

// Dark by default (docs/prd/02-frontend.md). The theme's values and its self-hosted fonts are in
// src/styles/theme.css.
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders per request, never at build: the Content-Security-Policy's nonce is new on
  // every response, and Next.js stamps it on the page's scripts while rendering (src/proxy.ts).
  await connection();
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
