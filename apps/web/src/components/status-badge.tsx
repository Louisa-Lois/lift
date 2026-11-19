import type { DeploymentStatus } from "@lift/shared";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";

/** Each status's label and dot colour (the theme's --status-* variables). */
export const STATUS_STYLES: Record<
  DeploymentStatus,
  { label: string; dot: string; pulse: boolean }
> = {
  queued: { label: "Queued", dot: "bg-status-queued", pulse: false },
  building: { label: "Building", dot: "bg-status-building", pulse: true },
  deploying: { label: "Deploying", dot: "bg-status-deploying", pulse: true },
  active: { label: "Active", dot: "bg-status-active", pulse: false },
  failed: { label: "Failed", dot: "bg-status-failed", pulse: false },
  canceled: { label: "Canceled", dot: "bg-status-canceled", pulse: false },
  superseded: { label: "Superseded", dot: "bg-status-canceled", pulse: false },
};

/** A deployment status: always the name next to its colour, so colour is never the only signal. */
export function StatusBadge({
  status,
  className,
}: {
  status: DeploymentStatus;
  className?: string;
}) {
  const style = STATUS_STYLES[status];
  return (
    <Badge variant="outline" data-status={status} className={cn("gap-1.5 font-normal", className)}>
      <span
        aria-hidden="true"
        data-slot="status-dot"
        className={cn("size-2 shrink-0 rounded-full", style.dot, style.pulse && "animate-pulse")}
      />
      {style.label}
    </Badge>
  );
}
