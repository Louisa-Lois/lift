import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";

// Every signed-in screen: /projects, /new, /p/… (the landing page and /login sit outside).
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <AuthGuard>{children}</AuthGuard>
    </AppShell>
  );
}
