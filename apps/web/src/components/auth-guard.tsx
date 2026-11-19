"use client";

import { isLiftApiError } from "@lift/shared";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { loginUrl } from "@/lib/auth";
import { useMe } from "@/lib/hooks/use-me";

/**
 * Shows signed-in screens only to a signed-in user. A 401 from /me sends you to /login and back
 * here afterwards; an invite-only 401 also says why.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { data: me, error, isPending } = useMe();
  const router = useRouter();
  const signedOut = isLiftApiError(error) && error.status === 401;

  useEffect(() => {
    if (!signedOut) return;
    const here = `${window.location.pathname}${window.location.search}`;
    router.replace(loginUrl(here, error.type));
  }, [signedOut, error, router]);

  if (me) return children;
  if (isPending || signedOut) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return (
    <EmptyState
      title="Can't reach Lift right now"
      description="The API didn't answer. Check your connection, then reload the page."
    />
  );
}
