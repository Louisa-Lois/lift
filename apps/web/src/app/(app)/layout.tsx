import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

// Every signed-in screen: /projects, /new, /p/… (the landing page and /login sit outside).
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
