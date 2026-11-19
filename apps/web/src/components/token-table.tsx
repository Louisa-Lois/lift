"use client";

import type { ApiToken, TokenScope } from "@lift/shared";
import { KeyRoundIcon } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { SCOPE_CHOICES } from "@/components/new-token-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { timeAgo } from "@/lib/format";
import { useNow } from "@/lib/hooks/use-now";
import { useRevokeToken, useTokens } from "@/lib/hooks/use-tokens";
import { showProblem } from "@/lib/problems";

const RANK: Record<TokenScope, number> = { read: 0, deploy: 1, admin: 2 };

/** A token's scope as the form named it: the highest of its scopes. */
function scopeLabel(scopes: TokenScope[]): string {
  const highest = scopes.reduce<TokenScope>((best, s) => (RANK[s] > RANK[best] ? s : best), "read");
  return SCOPE_CHOICES.find((choice) => choice.value === highest)?.label ?? highest;
}

/** Your personal tokens: never the token itself, only its first characters. */
export function TokenTable() {
  const tokens = useTokens();
  const now = useNow(true, 30_000);

  if (tokens.isPending) {
    return (
      <div role="status" aria-label="Loading tokens" className="grid gap-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  }
  if (tokens.isError) {
    return (
      <EmptyState
        title="Couldn't load your tokens"
        description="Check your connection and try again."
        action={
          <Button variant="outline" onClick={() => void tokens.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  if (tokens.data.data.length === 0) {
    return (
      <EmptyState
        icon={<KeyRoundIcon className="size-8" />}
        title="No tokens yet"
        description="Create one to sign in the lift CLI, the MCP server or a script."
      />
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Token</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>
              <span className="sr-only">Status</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.data.data.map((token) => (
            <TokenRow key={token.id} token={token} now={now} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TokenRow({ token, now }: { token: ApiToken; now: number }) {
  const revoke = useRevokeToken();
  const revoked = token.revokedAt !== null;

  async function revokeIt() {
    try {
      await revoke.mutateAsync(token.id);
      toast.success(`Revoked ${token.name}`);
    } catch (error) {
      showProblem(error);
      throw error;
    }
  }

  return (
    <TableRow className={revoked ? "text-muted-foreground" : undefined}>
      <TableCell className="font-medium">{token.name}</TableCell>
      <TableCell className="font-mono text-xs">{token.prefix}…</TableCell>
      <TableCell>{scopeLabel(token.scopes)}</TableCell>
      <TableCell>
        {token.lastUsedAt ? `Used ${timeAgo(token.lastUsedAt, now)}` : "Never used"}
      </TableCell>
      <TableCell>{timeAgo(token.createdAt, now)}</TableCell>
      <TableCell className="text-right">
        {revoked ? (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            Revoked
          </Badge>
        ) : (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" aria-label={`Revoke ${token.name}`}>
                Revoke
              </Button>
            }
            title={`Revoke ${token.name}?`}
            description={
              <p>
                Anything that uses it, like the CLI on that machine, stops working at its next
                request. You can't undo this.
              </p>
            }
            confirmLabel="Revoke"
            pendingLabel="Revoking…"
            destructive
            onConfirm={revokeIt}
          />
        )}
      </TableCell>
    </TableRow>
  );
}
