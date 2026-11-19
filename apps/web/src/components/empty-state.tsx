import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** What a list or page shows when there is nothing in it yet, with an optional call to action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center",
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <h2 className="font-heading font-medium text-base">{title}</h2>
      {description ? <p className="max-w-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}
