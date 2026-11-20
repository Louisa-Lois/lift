"use client";

import { isLiftApiError, type ProjectEvent } from "@lift/shared";
import {
  ArrowLeftIcon,
  FileCode2Icon,
  GitBranchIcon,
  LockIcon,
  MonitorIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { buildFileTree, fileName, fileProblem } from "@/lib/editor-files";
import { useEditorChanges, useEditorTree } from "@/lib/hooks/use-editor";
import { useMe } from "@/lib/hooks/use-me";
import { useMembers } from "@/lib/hooks/use-members";
import { useProjectEvents } from "@/lib/hooks/use-project-events";
import { useProject } from "@/lib/hooks/use-projects";
import { cn } from "@/lib/utils";
import { ChangesRail } from "./changes-rail";
import { CommitDialog } from "./commit-dialog";
import { FileTree } from "./file-tree";
import { LazyMonacoPane } from "./lazy-monaco-pane";
import type { Connection, LiveFileState } from "./live-file";
import { PresenceAvatars } from "./presence-avatars";

const CONNECTION: Record<Connection, { label: string; dot: string }> = {
  connecting: { label: "Connecting…", dot: "bg-status-building animate-pulse" },
  connected: { label: "Connected", dot: "bg-status-active" },
  disconnected: { label: "Reconnecting…", dot: "bg-status-building animate-pulse" },
};

const PLACEHOLDER = {
  binary: {
    title: "Can't edit binary files",
    description: "Images, fonts, archives and other binary files open on GitHub.",
  },
  "too-large": {
    title: "Too large to edit here",
    description: "The editor opens text files up to 512 KB.",
  },
};

/**
 * The live editor (FE-13, docs/prd/02-frontend.md): the service's files, a tab per open file,
 * and Monaco on each file's live document, which everyone with the file open edits together.
 * Viewers read along. Editors commit and deploy the changes (BE-18): "Changes (N)" opens the list,
 * a dot marks a changed tab, and everyone hears about a commit. Phones get a note instead: the
 * editor needs a larger screen.
 */
export function EditorScreen({ projectId, serviceId }: { projectId: string; serviceId: string }) {
  const project = useProject(projectId);
  const tree = useEditorTree(serviceId);
  const service = project.data?.services.find((candidate) => candidate.id === serviceId);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [states, setStates] = useState<Record<string, LiveFileState>>({});
  const [railOpen, setRailOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const router = useRouter();
  const me = useMe();
  const members = useMembers(projectId);
  const changes = useEditorChanges(serviceId);
  const changed = useMemo(
    () => new Set((changes.data?.data ?? []).map((change) => change.path)),
    [changes.data],
  );

  // Someone else's commit: their files are no longer changes (the cache sees to that); say so.
  useProjectEvents(projectId, (event: ProjectEvent) => {
    if (event.type !== "editor.committed" || event.data.serviceId !== serviceId) return;
    if (event.actorId === me.data?.id) return;
    const author = members.data?.data.find((member) => member.userId === event.actorId)?.user;
    const count = event.data.paths.length;
    toast(
      `${author?.name ?? author?.login ?? "Someone"} committed ${count === 1 ? fileName(event.data.paths[0] ?? "") : `${count} files`}`,
      {
        description: event.data.message.split("\n", 1)[0],
        ...(event.data.deploymentId
          ? {
              action: {
                label: "Open deployment",
                onClick: () =>
                  router.push(`/p/${projectId}/deployments/${event.data.deploymentId}`),
              },
            }
          : {}),
      },
    );
  });

  const files = useMemo(
    () => new Map((tree.data?.files ?? []).map((file) => [file.path, file])),
    [tree.data],
  );
  const nodes = useMemo(
    () => (tree.data && service ? buildFileTree(tree.data.files, service.rootDir) : []),
    [tree.data, service],
  );
  const editable = useMemo(
    () =>
      tabs.filter((path) => {
        const file = files.get(path);
        return file !== undefined && fileProblem(file) === null;
      }),
    [tabs, files],
  );

  function open(path: string) {
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
    setActive(path);
  }

  function close(path: string) {
    const index = tabs.indexOf(path);
    const rest = tabs.filter((tab) => tab !== path);
    setTabs(rest);
    setStates(({ [path]: _, ...others }) => others);
    if (active === path) setActive(rest[Math.min(index, rest.length - 1)] ?? null);
  }

  function onFileState(path: string, state: LiveFileState) {
    setStates((current) => ({ ...current, [path]: { ...current[path], ...state } }));
  }

  if (project.isError || tree.isError) {
    const error = project.error ?? tree.error;
    const missing = isLiftApiError(error) && error.status === 404;
    return (
      <div className="p-6">
        <EmptyState
          title={missing ? "Nothing to edit here" : "Can't open the editor"}
          description={
            missing
              ? "This service or its branch doesn't exist, or you're not a member of its project."
              : // The API says what went wrong and what to do, such as whose GitHub token GitHub
                // refused. Only a request that got no answer at all is about the connection.
                isLiftApiError(error)
                ? error.detail || error.title
                : "Lift didn't answer. Check your connection, then reload the page."
          }
          action={
            <Link href={`/p/${projectId}`} className="text-sm underline underline-offset-4">
              Back to the project
            </Link>
          }
        />
      </div>
    );
  }

  const activeFile = active ? files.get(active) : undefined;
  const problem = activeFile ? fileProblem(activeFile) : null;
  const state = active ? states[active] : undefined;
  const canEdit = project.data !== undefined && project.data.role !== "viewer";
  const readOnly = !canEdit || state?.readOnly === true;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Link
          href={`/p/${projectId}?service=${serviceId}`}
          aria-label="Back to the service"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
        </Link>
        {service ? (
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate font-heading font-medium">{service.name}</h1>
            <span className="hidden items-center gap-1 font-mono text-muted-foreground text-xs sm:flex">
              <GitBranchIcon className="size-3" aria-hidden="true" />
              {service.repo.branch}
            </span>
          </div>
        ) : (
          <Skeleton className="h-5 w-32" />
        )}
        <div className="ml-auto flex items-center gap-3">
          {readOnly && active ? (
            <Badge variant="outline" className="gap-1">
              <LockIcon className="size-3" aria-hidden="true" />
              Read-only
            </Badge>
          ) : null}
          {state?.connection && !problem ? (
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs" role="status">
              <span className={cn("size-2 rounded-full", CONNECTION[state.connection].dot)} />
              {CONNECTION[state.connection].label}
            </span>
          ) : null}
          <PresenceAvatars people={state?.people ?? []} />
          <Button
            variant="outline"
            size="sm"
            aria-pressed={railOpen}
            onClick={() => setRailOpen((open) => !open)}
            className="hidden md:inline-flex"
          >
            Changes ({changed.size})
          </Button>
          {canEdit ? (
            <Button
              size="sm"
              disabled={changed.size === 0}
              onClick={() => setCommitOpen(true)}
              className="hidden md:inline-flex"
            >
              Commit & deploy
            </Button>
          ) : null}
        </div>
      </header>
      {commitOpen ? (
        <CommitDialog
          projectId={projectId}
          serviceId={serviceId}
          changes={changes.data?.data ?? []}
          open
          onOpenChange={setCommitOpen}
        />
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center md:hidden">
        <MonitorIcon className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">Open on a larger screen</p>
        <p className="max-w-xs text-muted-foreground text-sm">
          The editor needs room for the code. Open this page on a computer or a tablet.
        </p>
      </div>

      <div className="hidden min-h-0 flex-1 md:flex">
        <nav aria-label="Files" className="w-60 shrink-0 overflow-y-auto border-r">
          {tree.data ? (
            <>
              <FileTree nodes={nodes} active={active} onOpen={open} />
              {tree.data.truncated ? (
                <p className="px-3 pb-3 text-muted-foreground text-xs">
                  GitHub listed only part of this repo.
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col gap-2 p-3" aria-busy="true">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={String(index)} className="h-4 w-full" />
              ))}
            </div>
          )}
        </nav>

        <section className="flex min-w-0 flex-1 flex-col">
          {tabs.length > 0 ? (
            <div
              role="tablist"
              aria-label="Open files"
              className="flex shrink-0 overflow-x-auto border-b"
            >
              {tabs.map((path) => (
                <div
                  key={path}
                  className={cn(
                    "flex shrink-0 items-center border-r font-mono text-xs",
                    path === active
                      ? "bg-background text-foreground shadow-[inset_0_-2px_0_var(--primary)]"
                      : "bg-muted/40 text-muted-foreground",
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={path === active}
                    title={path}
                    onClick={() => setActive(path)}
                    className="py-2 pr-1 pl-3"
                  >
                    {fileName(path)}
                    {changed.has(path) ? (
                      <span
                        role="img"
                        aria-label="Changed"
                        className="ml-1.5 inline-block size-1.5 rounded-full bg-primary align-middle"
                      />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${fileName(path)}`}
                    onClick={() => close(path)}
                    className="mr-1 rounded p-1 hover:bg-muted hover:text-foreground"
                  >
                    <XIcon className="size-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1">
            {service ? (
              <LazyMonacoPane
                serviceId={serviceId}
                paths={editable}
                active={problem ? null : active}
                onFileState={onFileState}
              />
            ) : null}
            {!active ? (
              <Overlay
                icon={<FileCode2Icon className="size-6" aria-hidden="true" />}
                title="Open a file"
                description="Pick a file on the left. Everyone with the same file open sees each other's changes as they type."
              />
            ) : problem ? (
              <Overlay {...PLACEHOLDER[problem]} />
            ) : state?.error ? (
              <Overlay title="Can't open this file" description={state.error} />
            ) : null}
          </div>
          {state?.crlf ? (
            <p className="border-t px-3 py-1.5 text-muted-foreground text-xs">
              This file has Windows line endings, so it opens read-only for now.
            </p>
          ) : null}
        </section>
        {railOpen ? (
          <ChangesRail
            serviceId={serviceId}
            changes={changes.data?.data ?? []}
            active={active}
            canEdit={canEdit}
            onOpen={open}
          />
        ) : null}
      </div>
    </div>
  );
}

function Overlay({
  icon,
  title,
  description,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background p-6">
      <EmptyState icon={icon} title={title} description={description} className="border-none" />
    </div>
  );
}
