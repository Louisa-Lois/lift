"use client";

import { isLiftApiError, StartCliLoginResponse } from "@lift/shared";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useCliLoginDecision } from "@/lib/hooks/use-cli-login";

const CliLoginCode = StartCliLoginResponse.shape.code;

/** The page's one column: the question and every outcome share its width. */
function Column({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-md flex-col gap-6">{children}</div>;
}

/**
 * /cli-auth?code=… (FE-11): where `lift login` sends you to let that CLI sign in as you. The code
 * is shown large, so you can check it against your terminal before you approve.
 */
export function CliApproval() {
  const code = useSearchParams().get("code")?.trim() ?? "";
  const decision = useCliLoginDecision();

  if (!CliLoginCode.safeParse(code).success) {
    return (
      <Column>
        <EmptyState
          title="This link has no login code"
          description="Run lift login again, and open the link it gives you."
        />
      </Column>
    );
  }

  if (decision.isSuccess) {
    return (
      <Column>
        {decision.data.status === "approved" ? (
          <EmptyState
            title="The CLI is signed in"
            description="You can close this tab and go back to your terminal."
          />
        ) : (
          <EmptyState title="Denied" description="The CLI won't be signed in." />
        )}
      </Column>
    );
  }

  // The code is unknown, expired or already decided: nothing left to do here.
  const error = decision.error;
  if (isLiftApiError(error) && (error.status === 404 || error.status === 409)) {
    return (
      <Column>
        <EmptyState title="This code can't be used" description={error.detail} />
      </Column>
    );
  }
  const failure = error
    ? isLiftApiError(error)
      ? error.detail
      : "Lift didn't answer. Check your connection and try again."
    : null;

  return (
    <Column>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading font-semibold text-xl">Sign in to the lift CLI?</h1>
        <p className="text-muted-foreground text-sm">
          Approve only if you just ran <code className="font-mono">lift login</code> and this code
          matches the one in your terminal.
        </p>
      </div>
      <div className="flex flex-col items-center gap-2 rounded-lg border bg-card px-4 py-6">
        <span className="text-muted-foreground text-xs">Login code</span>
        <span className="font-mono font-semibold text-3xl tracking-widest">{code}</span>
      </div>
      <p className="text-muted-foreground text-sm">
        The CLI gets a token with full access to your account. You can revoke it in{" "}
        <Link href="/account/tokens" className="text-foreground underline underline-offset-4">
          API tokens
        </Link>
        .
      </p>
      {failure ? (
        <p role="alert" className="rounded-lg border bg-card p-4 text-sm">
          {failure}
        </p>
      ) : null}
      <div className="flex gap-3">
        <Button
          disabled={decision.isPending}
          onClick={() => decision.mutate({ code, approve: true })}
        >
          Approve
        </Button>
        <Button
          variant="outline"
          disabled={decision.isPending}
          onClick={() => decision.mutate({ code, approve: false })}
        >
          Deny
        </Button>
      </div>
    </Column>
  );
}
