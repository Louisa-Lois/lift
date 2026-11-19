"use client";

import {
  ASSIGNABLE_ROLES,
  type AssignableRole,
  GithubLogin,
  type ProjectMember,
  type ProjectRole,
} from "@lift/shared";
import { UserPlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormField, fieldAria } from "@/components/form-field";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAddMember,
  useMembers,
  useRemoveMember,
  useUpdateMember,
} from "@/lib/hooks/use-members";
import { showProblem } from "@/lib/problems";

const ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};
const ROLE_HINTS: Record<AssignableRole, string> = {
  editor: "Deploys, edits variables and code, and adds services",
  viewer: "Sees everything except secrets, and changes nothing",
};

/**
 * The project's members (BE-15, FE-11): the owner adds people by GitHub login, changes them
 * between editor and viewer, and removes them. Everyone else sees the list.
 */
export function MembersSection({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const members = useMembers(projectId);
  return (
    <section aria-labelledby="members-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="members-heading" className="font-medium">
          Members
        </h2>
        <p className="text-muted-foreground text-sm">
          {isOwner
            ? "Add people by GitHub login. They need to have signed in to Lift once."
            : "Only the project's owner adds and removes people."}
        </p>
      </div>
      {isOwner ? <InviteForm projectId={projectId} /> : null}
      {members.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : members.isError ? (
        <p className="text-destructive text-sm">Lift couldn't load the members.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {members.data.data.map((member) => (
            <MemberRow
              key={member.userId}
              projectId={projectId}
              member={member}
              isOwner={isOwner}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function InviteForm({ projectId }: { projectId: string }) {
  const add = useAddMember(projectId);
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<AssignableRole>("editor");
  const [error, setError] = useState<string | undefined>();

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = GithubLogin.safeParse(login.trim());
    if (!parsed.success) {
      setError("Enter a GitHub login, like octocat");
      return;
    }
    setError(undefined);
    add.mutate(
      { login: parsed.data, role },
      {
        onSuccess: () => {
          toast.success(`Added ${parsed.data} as ${ROLE_LABELS[role].toLowerCase()}.`);
          setLogin("");
        },
        onError: (problem) =>
          showProblem(problem, (field, message) => {
            if (field !== "login") return false;
            setError(message);
            return true;
          }),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <div className="min-w-48 flex-1">
        <FormField id="member-login" label="GitHub login" error={error}>
          <Input
            id="member-login"
            value={login}
            placeholder="octocat"
            autoComplete="off"
            onChange={(event) => setLogin(event.target.value)}
            {...fieldAria("member-login", error, false)}
          />
        </FormField>
      </div>
      <FormField id="member-role" label="Role">
        <NativeSelect
          id="member-role"
          value={role}
          onChange={(event) => setRole(event.target.value as AssignableRole)}
        >
          {ASSIGNABLE_ROLES.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {ROLE_LABELS[option]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </FormField>
      <Button type="submit" disabled={add.isPending || login.trim() === ""}>
        <UserPlusIcon aria-hidden="true" />
        Add
      </Button>
      <p className="w-full text-muted-foreground text-xs">{ROLE_HINTS[role]}.</p>
    </form>
  );
}

function MemberRow({
  projectId,
  member,
  isOwner,
}: {
  projectId: string;
  member: ProjectMember;
  isOwner: boolean;
}) {
  const update = useUpdateMember(projectId);
  const remove = useRemoveMember(projectId);
  const { user } = member;
  const editable = isOwner && member.role !== "owner";
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Avatar className="size-8">
        <AvatarImage src={user.avatarUrl} alt="" />
        <AvatarFallback>{user.login.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-sm">{user.name ?? user.login}</span>
        <span className="truncate text-muted-foreground text-xs">@{user.login}</span>
      </div>
      {editable ? (
        <>
          <NativeSelect
            aria-label={`Role of ${user.login}`}
            value={member.role}
            disabled={update.isPending}
            onChange={(event) =>
              update.mutate(
                { userId: member.userId, role: event.target.value as AssignableRole },
                { onError: (problem) => showProblem(problem) },
              )
            }
          >
            {ASSIGNABLE_ROLES.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {ROLE_LABELS[option]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm">
                Remove
              </Button>
            }
            title={`Remove ${user.login}?`}
            description="They lose access to this project at once. You can add them again later."
            confirmLabel="Remove"
            pendingLabel="Removing…"
            destructive
            onConfirm={() =>
              remove.mutateAsync(member.userId).catch((problem) => {
                showProblem(problem);
                throw problem;
              })
            }
          />
        </>
      ) : (
        <Badge variant={member.role === "owner" ? "secondary" : "outline"}>
          {ROLE_LABELS[member.role]}
        </Badge>
      )}
    </li>
  );
}
