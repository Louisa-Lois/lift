import { PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import { NewTokenDialog } from "@/components/new-token-dialog";
import { TokenTable } from "@/components/token-table";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "API tokens · Lift" };

/** /account/tokens (FE-11): create a personal token, see it once, revoke it. */
export default function TokensPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="font-heading font-semibold text-xl">API tokens</h1>
          <p className="text-muted-foreground text-sm">
            A personal token signs in the lift CLI, the MCP server or a script as you. Keep it
            secret, and revoke any you no longer use.
          </p>
        </div>
        <NewTokenDialog
          trigger={
            <Button>
              <PlusIcon aria-hidden="true" />
              New token
            </Button>
          }
        />
      </div>
      <TokenTable />
    </div>
  );
}
