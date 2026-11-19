"use client";

import type { LogEntry } from "@lift/shared";
import { ArrowDownIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { AnsiLine } from "@/components/ansi-line";
import { Button } from "@/components/ui/button";
import { clockTime } from "@/lib/format";
import type { LogStreamState } from "@/lib/hooks/use-log-stream";
import { cn } from "@/lib/utils";

function LogRow({ line }: { line: LogEntry }) {
  return (
    <div
      data-stream={line.stream}
      className={cn(
        "flex gap-3 px-4 whitespace-pre-wrap break-all",
        line.stream === "system" && "font-semibold text-foreground",
        line.stream === "deploy" && "text-muted-foreground",
      )}
    >
      <time dateTime={line.ts} className="shrink-0 select-none text-muted-foreground/70">
        {clockTime(line.ts)}
      </time>
      <span className="min-w-0 flex-1">
        <AnsiLine text={line.line} />
      </span>
    </div>
  );
}

/**
 * The build and deploy log (docs/prd/02-frontend.md, "Deployment page"): virtualised, so 50,000
 * lines scroll smoothly; follows new lines while you're at the bottom; "Jump to latest" when you
 * scrolled up; "Reconnecting…" while the stream is down.
 */
export function LogViewer({ lines, state }: { lines: LogEntry[]; state: LogStreamState }) {
  const list = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);

  return (
    <div className="relative flex h-[calc(100dvh-16rem)] min-h-96 flex-col overflow-hidden rounded-lg border bg-card font-mono text-xs leading-5">
      {state === "reconnecting" ? (
        <div
          role="status"
          className="absolute top-2 right-3 z-10 rounded-md border bg-background px-2 py-1 font-sans text-muted-foreground"
        >
          Reconnecting…
        </div>
      ) : null}
      {lines.length === 0 ? (
        <p className="p-4 font-sans text-muted-foreground text-sm">
          {state === "ended" ? "This deployment has no log lines." : "Waiting for the first line…"}
        </p>
      ) : (
        <Virtuoso
          ref={list}
          aria-label="Log"
          data={lines}
          computeItemKey={(_, line) => line.id}
          itemContent={(_, line) => <LogRow line={line} />}
          initialTopMostItemIndex={lines.length - 1}
          followOutput={(bottom) => (bottom ? "auto" : false)}
          atBottomStateChange={setAtBottom}
          atBottomThreshold={48}
          className="flex-1 py-2"
        />
      )}
      {!atBottom && lines.length > 0 ? (
        <Button
          size="sm"
          className="absolute right-3 bottom-3 font-sans"
          onClick={() => list.current?.scrollToIndex({ index: lines.length - 1, behavior: "auto" })}
        >
          <ArrowDownIcon aria-hidden="true" />
          Jump to latest
        </Button>
      ) : null}
    </div>
  );
}
