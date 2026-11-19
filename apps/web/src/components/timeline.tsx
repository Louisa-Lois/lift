import type { DeploymentTimelineEntry } from "@lift/shared";
import { STATUS_STYLES } from "@/components/status-badge";
import { clockTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A deployment's steps, oldest first: each status with its time and the worker's message. */
export function Timeline({ steps }: { steps: DeploymentTimelineEntry[] }) {
  return (
    <ol aria-label="Timeline" className="flex flex-col gap-3">
      {steps.map((step) => {
        const style = STATUS_STYLES[step.status];
        return (
          <li key={step.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className={cn("mt-1.5 size-2 shrink-0 rounded-full", style.dot)}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">{style.label}</span>
                <time dateTime={step.at} className="text-muted-foreground text-xs">
                  {clockTime(step.at)}
                </time>
              </div>
              {step.message ? (
                <p className="break-words text-muted-foreground text-xs">{step.message}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
