import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGuard } from "@/components/auth-guard";

// The live editor: the same top bar as every signed-in screen, with the page below it filling the
// window instead of a centred column.
export default function EditorLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell wide>
      <AuthGuard>{children}</AuthGuard>
    </AppShell>
  );
}
