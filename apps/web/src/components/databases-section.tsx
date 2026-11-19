"use client";

import type { Database } from "@lift/shared";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { DatabaseCard } from "@/components/database-card";
import { Button } from "@/components/ui/button";
import { useCreateDatabase } from "@/lib/hooks/use-databases";
import { showProblem } from "@/lib/problems";

/**
 * The project's databases (FE-08) until FE-06's canvas: "Add Postgres", then a card that follows
 * the project stream from provisioning to ready. One per project; Redis comes later.
 */
export function DatabasesSection({
  projectId,
  databases,
  canEdit,
}: {
  projectId: string;
  databases: Database[];
  canEdit: boolean;
}) {
  const create = useCreateDatabase(projectId);
  const hasPostgres = databases.some((database) => database.type === "postgres");

  async function addPostgres() {
    try {
      await create.mutateAsync(undefined);
      toast.success("Creating Postgres", {
        description: "Every service gets DATABASE_URL once it's ready. Deploy to use it.",
      });
    } catch (error) {
      showProblem(error);
    }
  }

  if (databases.length === 0 && !canEdit) return null;
  return (
    <section aria-labelledby="databases-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 id="databases-heading" className="font-medium text-muted-foreground text-sm">
          Databases
        </h2>
        {canEdit && !hasPostgres ? (
          <Button variant="outline" size="sm" onClick={addPostgres} disabled={create.isPending}>
            <PlusIcon aria-hidden="true" />
            {create.isPending ? "Adding…" : "Add Postgres"}
          </Button>
        ) : null}
      </div>
      {databases.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
          No database yet. Add Postgres and every service gets DATABASE_URL.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {databases.map((database) => (
            <DatabaseCard key={database.id} database={database} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </section>
  );
}
