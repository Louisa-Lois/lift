"use client";

import { isLiftApiError, type Service } from "@lift/shared";
import { FileTextIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AddFromDotenv } from "@/components/add-from-dotenv";
import { EnvRawEditor } from "@/components/env-raw-editor";
import { EnvTable, type VariableChanges } from "@/components/env-table";
import { StagedBanner } from "@/components/staged-banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeploy } from "@/lib/hooks/use-deployments";
import { useRevealedVariables, useSaveVariables, useVariables } from "@/lib/hooks/use-variables";
import { showProblem } from "@/lib/problems";

const FIELD = /^variables\.(.+)$/;

/**
 * FE-07: the service panel's Variables tab. The table stages edits until Save; the raw editor
 * and "Add from .env" handle many at once. Saved changes wait for a deploy, and a banner says so.
 */
export function VariablesTab({
  service,
  canEdit,
  onDeployed,
}: {
  service: Service;
  canEdit: boolean;
  /** After the banner's Deploy queues a deployment, e.g. to show the Deployments tab. */
  onDeployed?: () => void;
}) {
  const variables = useVariables(service.id);
  const [wantPlain, setWantPlain] = useState(false);
  const [mode, setMode] = useState<"table" | "raw">("table");
  const revealed = useRevealedVariables(service.id, canEdit && (wantPlain || mode === "raw"));
  const save = useSaveVariables(service.id);
  const deploy = useDeploy();
  const [changes, setChanges] = useState<VariableChanges>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Deletions leave no row behind, so the banner counts them from the last save.
  const [lastSave, setLastSave] = useState<{ at: number; deleted: number } | null>(null);

  const plain = useMemo(
    () =>
      revealed.data
        ? Object.fromEntries(revealed.data.data.map((variable) => [variable.key, variable.value]))
        : undefined,
    [revealed.data],
  );

  if (variables.isPending) {
    return (
      <div role="status" aria-label="Loading variables" className="grid gap-2">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    );
  }
  if (variables.isError) {
    return (
      <div className="flex items-center justify-between rounded-lg border px-4 py-3 text-sm">
        Couldn't load the variables.
        <Button variant="outline" size="sm" onClick={() => void variables.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const list = variables.data.data;
  const deployedAt = service.latestDeployment ? Date.parse(service.latestDeployment.createdAt) : 0;
  const staged =
    list.filter((variable) => Date.parse(variable.updatedAt) > deployedAt).length +
    (lastSave && lastSave.at > deployedAt ? lastSave.deleted : 0);
  const pending = Object.keys(changes).length;

  async function saveChanges(toSave: VariableChanges): Promise<boolean> {
    try {
      await save.mutateAsync(toSave);
      setLastSave({
        at: Date.now(),
        deleted: Object.values(toSave).filter((value) => value === null).length,
      });
      setErrors({});
      return true;
    } catch (error) {
      const fields = isLiftApiError(error) ? (error.fields ?? {}) : {};
      const byKey: Record<string, string> = {};
      for (const [field, message] of Object.entries(fields)) {
        const key = FIELD.exec(field)?.[1];
        if (key) byKey[key] = message;
      }
      setErrors(byKey);
      if (Object.keys(byKey).length === 0) showProblem(error);
      return false;
    }
  }

  async function deployNow() {
    try {
      await deploy.mutateAsync(service.id);
      onDeployed?.();
    } catch (error) {
      showProblem(error);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {staged > 0 ? (
        <StagedBanner
          count={staged}
          canDeploy={canEdit}
          deploying={deploy.isPending}
          onDeploy={deployNow}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Encrypted at rest. They reach the app, and its build, with the next deploy.
        </p>
        {canEdit && mode === "table" ? (
          <div className="flex gap-2">
            <AddFromDotenv
              existing={new Set(list.map((variable) => variable.key))}
              onAdd={(values) => setChanges({ ...changes, ...values })}
            />
            <Button variant="outline" size="sm" onClick={() => setMode("raw")}>
              <FileTextIcon aria-hidden="true" />
              Raw editor
            </Button>
          </div>
        ) : null}
      </div>

      {mode === "raw" ? (
        plain ? (
          <EnvRawEditor
            current={plain}
            saving={save.isPending}
            onCancel={() => setMode("table")}
            onSave={async (toSave) => {
              if (await saveChanges(toSave)) {
                setMode("table");
                toast.success("Saved. Deploy to apply.");
              }
            }}
          />
        ) : (
          <Skeleton className="h-40" />
        )
      ) : (
        <>
          <EnvTable
            variables={list}
            revealed={plain}
            onReveal={() => setWantPlain(true)}
            canEdit={canEdit}
            changes={changes}
            onChange={setChanges}
            errors={errors}
          />
          {pending > 0 ? (
            <div className="sticky bottom-0 flex items-center justify-between gap-3 rounded-lg border bg-background px-4 py-2.5">
              <p className="text-sm">
                {pending} unsaved {pending === 1 ? "change" : "changes"}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() => {
                    setChanges({});
                    setErrors({});
                  }}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  disabled={save.isPending}
                  onClick={async () => {
                    if (await saveChanges(changes)) setChanges({});
                  }}
                >
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
