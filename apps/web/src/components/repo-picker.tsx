"use client";

import { isLiftApiError } from "@lift/shared";
import { ChevronRightIcon, LinkIcon, LockIcon, SearchIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { parseGithubRepo } from "@/lib/github-url";
import { useDebouncedValue, useRepos } from "@/lib/hooks/use-github";

/** A repo chosen in the picker. For a pasted URL, the default branch and visibility are unknown. */
export type PickedRepo = {
  owner: string;
  name: string;
  defaultBranch: string | null;
  private: boolean | null;
};

const rowClass =
  "flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50";

/** The first step of /new: search the repos you can access, or paste a GitHub URL. */
export function RepoPicker({ onPick }: { onPick: (repo: PickedRepo) => void }) {
  const [text, setText] = useState("");
  const pasted = parseGithubRepo(text);
  // A pasted URL searches for its owner/name, so a repo you can access keeps its default branch.
  const wanted = pasted ? `${pasted.owner}/${pasted.name}` : text.trim();
  const query = useDebouncedValue(wanted, 300);
  const repos = useRepos(query);
  const list = repos.data?.data ?? [];
  const listed =
    pasted &&
    list.some(
      (repo) =>
        repo.owner.toLowerCase() === pasted.owner.toLowerCase() &&
        repo.name.toLowerCase() === pasted.name.toLowerCase(),
    );

  let body: ReactNode;
  if (repos.isPending) {
    body = (
      <ul aria-label="Loading repos" className="divide-y">
        {[0, 1, 2, 3, 4].map((row) => (
          <li key={row} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="ml-auto h-3 w-12" />
          </li>
        ))}
      </ul>
    );
  } else if (repos.isError) {
    const error = repos.error;
    body = (
      <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="font-medium">Couldn't load your repos</p>
        <p className="max-w-md text-muted-foreground">
          {isLiftApiError(error)
            ? error.detail || error.title
            : "Check your connection and try again."}
        </p>
        <Button variant="outline" size="sm" onClick={() => void repos.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else {
    body = (
      <ul aria-label="Repos" className="divide-y">
        {pasted && !listed ? (
          <li>
            <button
              type="button"
              className={rowClass}
              onClick={() => onPick({ ...pasted, defaultBranch: null, private: null })}
            >
              <LinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">
                Use{" "}
                <span className="font-medium">
                  {pasted.owner}/{pasted.name}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground text-xs">From the URL</span>
              <ChevronRightIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          </li>
        ) : null}
        {list.map((repo) => (
          <li key={`${repo.owner}/${repo.name}`}>
            <button type="button" className={rowClass} onClick={() => onPick(repo)}>
              <span className="min-w-0 flex-1 truncate">
                <span className="text-muted-foreground">{repo.owner}/</span>
                <span className="font-medium">{repo.name}</span>
              </span>
              {repo.private ? (
                <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                  <LockIcon aria-hidden="true" />
                  Private
                </Badge>
              ) : null}
              {repo.pushedAt ? (
                <span className="w-16 shrink-0 text-right text-muted-foreground text-xs">
                  <span className="sr-only">Last push </span>
                  {timeAgo(repo.pushedAt)}
                </span>
              ) : null}
              <ChevronRightIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
        {list.length === 0 && !pasted ? (
          <li className="px-4 py-10 text-center text-muted-foreground">
            {query ? `No repos match “${query}”.` : "No repos yet. Push one to GitHub first."}
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Search your repos, or paste a GitHub URL"
          aria-label="Search your repos, or paste a GitHub URL"
          className="h-9 pl-8 [&::-webkit-search-cancel-button]:hidden"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div
        // Dim the last results while typing settles and while the new ones load.
        aria-busy={repos.isFetching || query !== wanted}
        className="overflow-hidden rounded-lg border transition-opacity aria-busy:opacity-70"
      >
        {body}
      </div>
      {repos.data?.nextCursor && !query ? (
        <p className="text-muted-foreground text-xs">
          Showing your 30 most recently pushed repos. Search to find the others.
        </p>
      ) : null}
    </div>
  );
}
