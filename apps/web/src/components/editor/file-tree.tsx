"use client";

import { ChevronRightIcon, FileIcon, FileX2Icon, FolderIcon } from "lucide-react";
import { useState } from "react";
import { fileProblem, type TreeNode } from "@/lib/editor-files";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The service's files, from its root directory (FE-13). Folders open and close; a file opens in
 * a tab. Files the editor can't open stay listed, dimmed, with the reason as their title.
 */
export function FileTree({
  nodes,
  active,
  onOpen,
}: {
  nodes: TreeNode[];
  active: string | null;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (path: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  function render(list: TreeNode[], depth: number) {
    return list.map((node) => {
      const indent = { paddingLeft: `${0.5 + depth * 0.75}rem` };
      if (node.children) {
        const expanded = open.has(node.path);
        return (
          <li key={node.path}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => toggle(node.path)}
              style={indent}
              className="flex w-full items-center gap-1.5 py-1 pr-2 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronRightIcon
                aria-hidden="true"
                className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
              />
              <FolderIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">{node.name}</span>
            </button>
            {expanded ? <ul>{render(node.children, depth + 1)}</ul> : null}
          </li>
        );
      }
      const problem = node.file ? fileProblem(node.file) : null;
      const title =
        problem === "binary"
          ? "Can't edit binary files"
          : problem === "too-large"
            ? `Too large to edit here (${formatBytes(node.file?.size ?? 0)})`
            : node.path;
      return (
        <li key={node.path}>
          <button
            type="button"
            title={title}
            aria-current={active === node.path ? "true" : undefined}
            onClick={() => onOpen(node.path)}
            style={{ paddingLeft: `${1.4 + depth * 0.75}rem` }}
            className={cn(
              "flex w-full items-center gap-1.5 py-1 pr-2 text-left hover:bg-muted",
              active === node.path && "bg-muted text-foreground",
              problem && "text-muted-foreground",
            )}
          >
            {problem ? (
              <FileX2Icon aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
              <FileIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
        </li>
      );
    });
  }

  return <ul className="py-2 font-mono text-xs">{render(nodes, 0)}</ul>;
}
