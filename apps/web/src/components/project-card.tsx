import type { ProjectListItem } from "@lift/shared";
import Link from "next/link";
import { STATUS_STYLES } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROLE_LABELS = { owner: null, editor: "Editor", viewer: "Viewer" } as const;

/** One project on /projects: its name, a status dot per service, and when it last deployed. */
export function ProjectCard({ project, now }: { project: ProjectListItem; now?: number }) {
  const count = project.services.length;
  const role = ROLE_LABELS[project.role];
  return (
    <Link
      href={`/p/${project.id}`}
      className="group rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-colors group-hover:bg-muted/40">
        <CardHeader>
          <CardTitle className="truncate">{project.name}</CardTitle>
          {role ? (
            <CardAction>
              <Badge variant="outline" className="font-normal text-muted-foreground">
                {role}
              </Badge>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-muted-foreground text-xs">
          {count === 0 ? (
            <p>No services yet</p>
          ) : (
            <ul aria-label="Services" className="flex flex-wrap gap-x-3 gap-y-1">
              {project.services.map((service) => {
                const style = service.status ? STATUS_STYLES[service.status] : null;
                const label = style?.label ?? "Not deployed";
                return (
                  <li key={service.id} className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      data-slot="status-dot"
                      className={cn("size-2 rounded-full", style?.dot ?? "bg-muted-foreground/40")}
                    />
                    <span className="text-foreground">{service.name}</span>
                    <span className="sr-only">: {label}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p>
            {project.lastDeployedAt
              ? `Deployed ${timeAgo(project.lastDeployedAt, now)}`
              : "Not deployed yet"}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
