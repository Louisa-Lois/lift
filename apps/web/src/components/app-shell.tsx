"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useMe } from "@/lib/hooks/use-me";

/** The frame around every signed-in screen: top bar with logo, navigation and the user menu. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link href="/projects" className="font-heading font-semibold text-base tracking-tight">
            Lift
          </Link>
          <nav aria-label="Main" className="flex items-center gap-4 text-muted-foreground">
            <Link href="/projects" className="transition-colors hover:text-foreground">
              Projects
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <kbd
              className="hidden rounded-md border px-1.5 py-0.5 font-mono text-muted-foreground text-xs sm:inline-block"
              title="Command menu"
            >
              ⌘K
            </kbd>
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}

function UserMenu() {
  const { data: me, isPending } = useMe();
  if (isPending) return <Skeleton className="size-8 rounded-full" />;
  if (!me) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar className="size-8">
          <AvatarImage src={me.avatarUrl} alt="" />
          <AvatarFallback>{me.login.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="font-normal">
          <div className="font-medium text-foreground">{me.name ?? me.login}</div>
          <div className="text-muted-foreground text-xs">@{me.login}</div>
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
