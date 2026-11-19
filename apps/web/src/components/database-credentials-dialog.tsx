"use client";

import type { Database } from "@lift/shared";
import { EyeIcon, EyeOffIcon, KeyRoundIcon } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useDatabaseCredentials } from "@/lib/hooks/use-databases";

/** "Credentials" (editors): how to connect, with the password behind an eye. */
export function DatabaseCredentialsDialog({ database }: { database: Database }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const credentials = useDatabaseCredentials(database.id, open);
  const data = credentials.data;
  const hidden = "••••••••••••";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setShown(false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRoundIcon aria-hidden="true" />
          Credentials
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{database.name} credentials</DialogTitle>
          <DialogDescription>
            Reachable only from this project's services, at lift-pg:5432. They already have it as{" "}
            {database.envVar}.
          </DialogDescription>
        </DialogHeader>
        {credentials.isPending ? (
          <div role="status" aria-label="Loading credentials" className="grid gap-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : credentials.isError || !data ? (
          <p className="text-destructive text-sm">Couldn't load the credentials. Try again.</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
            {[
              [
                "URL",
                shown ? data.url : data.url.replace(`:${data.password}@`, `:${hidden}@`),
                data.url,
              ],
              ["Host", data.host, data.host],
              ["Port", String(data.port), String(data.port)],
              ["Database", data.database ?? "", data.database ?? ""],
              ["User", data.username ?? "", data.username ?? ""],
              ["Password", shown ? data.password : hidden, data.password],
            ].map(([label, text, copy]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 truncate font-mono text-xs">{text}</dd>
                <dd>
                  <CopyButton value={copy ?? ""} label={`Copy the ${label?.toLowerCase()}`} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {data ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            aria-pressed={shown}
            onClick={() => setShown(!shown)}
          >
            {shown ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
            {shown ? "Hide the password" : "Show the password"}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
