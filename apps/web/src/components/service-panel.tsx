"use client";

import type { Service } from "@lift/shared";
import { ExternalLinkIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ServiceDeployments } from "@/components/service-deployments";
import { StatusBadge } from "@/components/status-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VariablesTab } from "@/components/variables-tab";

const TABS = ["deployments", "variables"] as const;
type Tab = (typeof TABS)[number];

/**
 * The service panel (docs/prd/02-frontend.md): a sheet over the project page that keeps the URL in
 * sync (`?service=&tab=`), so it can be shared. Deployments and Variables for now; FE-06 brings
 * the canvas under it and the other tabs.
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
              </TabsList>
              <TabsContent value="deployments" className="mt-3 rounded-lg border">
                <ServiceDeployments service={service} />
              </TabsContent>
              <TabsContent value="variables" className="mt-3">
                <VariablesTab
                  service={service}
                  canEdit={canEdit}
                  onDeployed={() => go({ service: service.id, tab: "deployments" })}
                />
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
