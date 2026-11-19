"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { LoginMessage } from "@/components/login-message";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { safeNext } from "@/lib/auth";
import { useMe } from "@/lib/hooks/use-me";

export function LoginScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const next = safeNext(params.get("next"));
  const error = params.get("error");
  const { data: me } = useMe();

  // Already signed in: go where you were heading.
  useEffect(() => {
    if (me) router.replace(next ?? "/projects");
  }, [me, next, router]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading font-semibold text-2xl tracking-tight">Lift</h1>
          <p className="text-muted-foreground">
            Deploy from GitHub, watch it run, and let the AI fix it.
          </p>
        </div>
        {error ? <LoginMessage error={error} login={params.get("login")} /> : null}
        <Button asChild size="lg">
          <a href={api.urls.githubSignIn(next)}>Continue with GitHub</a>
        </Button>
      </div>
    </main>
  );
}
