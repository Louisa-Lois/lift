import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "Lift",
  description: "Deploy from GitHub, watch it run, let the AI fix it, and edit it together.",
};

// Dark by default (docs/prd/02-frontend.md); the theme's values are in src/styles/theme.css.
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Every page renders per request, never at build: the Content-Security-Policy's nonce is new on
  // every response, and Next.js stamps it on the page's scripts while rendering (src/proxy.ts).
  await connection();
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
