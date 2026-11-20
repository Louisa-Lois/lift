"use client";

import type { Service } from "@lift/shared";
import { CodeIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RestartServiceButton } from "@/components/deployment-actions";
import { ServiceDeployments } from "@/components/service-deployments";
import { ServiceSettingsTab } from "@/components/service-settings-tab";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VariablesTab } from "@/components/variables-tab";

const TABS = ["deployments", "variables", "settings"] as const;
type Tab = (typeof TABS)[number];

/**
 * The service panel (docs/prd/02-frontend.md): a sheet over the project page that keeps the URL in
 * sync (`?service=&tab=`), so it can be shared. Deployments, Variables and Settings (autofix) for
 * now; FE-06 brings the canvas under it and the other tabs.
 */
export function ServicePanel({ services, canEdit }: { services: Service[]; canEdit: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const service = services.find((candidate) => candidate.id === params.get("service")) ?? null;
  const requested = params.get("tab");
  const tab: Tab = TABS.find((name) => name === requested) ?? "deployments";

  function go(next: { service: string | null; tab: Tab | null }) {
    const query = new URLSearchParams(params);
    for (const [name, value] of Object.entries(next)) {
      if (value === null) query.delete(name);
      else query.set(name, value);
    }
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  return (
    <Sheet
      open={service !== null}
      onOpenChange={(open) => {
        if (!open) go({ service: null, tab: null });
      }}
    >
      <SheetContent
        side="right"
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-3xl"
      >
        {service ? (
          <>
            <SheetHeader className="gap-1.5 pr-12">
              <div className="flex items-center gap-2">
                <SheetTitle className="truncate">{service.name}</SheetTitle>
                {service.latestDeployment ? (
                  <StatusBadge status={service.latestDeployment.status} />
                ) : null}
                {canEdit && service.activeDeploymentId ? (
                  <RestartServiceButton serviceId={service.id} serviceName={service.name} />
                ) : null}
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/p/${service.projectId}/services/${service.id}/editor`}>
                    <CodeIcon aria-hidden="true" />
                    Open editor
                  </Link>
                </Button>
              </div>
              <SheetDescription asChild>
                {service.activeDeploymentId ? (
                  <a
                    href={service.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex w-fit items-center gap-1 font-mono text-xs hover:text-foreground"
                  >
                    {new URL(service.url).host}
                    <ExternalLinkIcon className="size-3" aria-hidden="true" />
                  </a>
                ) : (
                  <span className="font-mono text-xs">{new URL(service.url).host}</span>
                )}
              </SheetDescription>
            </SheetHeader>
            <Tabs
              value={tab}
              onValueChange={(value) => go({ service: service.id, tab: value as Tab })}
              className="px-4 pb-6"
            >
              <TabsList>
                <TabsTrigger value="deployments">Deployments</TabsTrigger>
                <TabsTrigger value="variables">Variables</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
              <TabsContent value="deployments" className="mt-3 rounded-lg border">
                <ServiceDeployments service={service} canEdit={canEdit} />
              </TabsContent>
              <TabsContent value="variables" className="mt-3">
                <VariablesTab
                  service={service}
                  canEdit={canEdit}
                  onDeployed={() => go({ service: service.id, tab: "deployments" })}
                />
              </TabsContent>
              <TabsContent value="settings" className="mt-3">
                <ServiceSettingsTab service={service} canEdit={canEdit} />
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
