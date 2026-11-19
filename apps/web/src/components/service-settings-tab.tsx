"use client";

import type { Service } from "@lift/shared";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useUpdateService } from "@/lib/hooks/use-services";
import { showProblem } from "@/lib/problems";

/**
 * The service panel's Settings tab. For now it holds the autofix switch (AI-06): on by default,
 * and editors can turn it off for a service whose failures they'd rather handle themselves.
 */
export function ServiceSettingsTab({ service, canEdit }: { service: Service; canEdit: boolean }) {
  const update = useUpdateService();
  // Shown at once; it goes back if the API refuses.
  const [autofix, setAutofix] = useState(service.autofix);
  useEffect(() => setAutofix(service.autofix), [service.autofix]);

  function change(next: boolean) {
    setAutofix(next);
    update.mutate(
      { serviceId: service.id, body: { autofix: next } },
      {
        onSuccess: () => toast.success(next ? "Autofix is on." : "Autofix is off."),
        onError: (error) => {
          setAutofix(!next);
          showProblem(error);
        },
      },
    );
  }

  return (
    <div className="flex items-start justify-between gap-6 rounded-lg border p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="autofix">Autofix</Label>
        <p id="autofix-hint" className="text-muted-foreground text-xs">
          When a deployment fails, the assistant finds out why. It fixes what's safe to fix by
          itself (the port, the Node or Python version, a default from .env.example) and deploys
          again, at most three times in a row. Commands and secrets it only suggests. Turned off,
          failures get no diagnosis and nothing changes by itself.
        </p>
        {canEdit ? null : (
          <p className="text-muted-foreground text-xs">
            Only the project's editors can change this.
          </p>
        )}
      </div>
      <Switch
        id="autofix"
        checked={autofix}
        disabled={!canEdit || update.isPending}
        aria-describedby="autofix-hint"
        onCheckedChange={change}
      />
    </div>
  );
}
