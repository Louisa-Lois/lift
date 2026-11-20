"use client";

import type { AddMemberBody, AssignableRole } from "@lift/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** A project's members, the owner first (BE-15). */
export function useMembers(projectId: string) {
  return useQuery({
    queryKey: queryKeys.members(projectId),
    queryFn: () => api.members.list(projectId),
  });
}

function useMemberMutation<T>(projectId: string, mutationFn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.members(projectId) }),
  });
}

export const useAddMember = (projectId: string) =>
  useMemberMutation(projectId, (body: AddMemberBody) => api.members.add(projectId, body));

export const useUpdateMember = (projectId: string) =>
  useMemberMutation(projectId, ({ userId, role }: { userId: string; role: AssignableRole }) =>
    api.members.update(projectId, userId, { role }),
  );

export const useRemoveMember = (projectId: string) =>
  useMemberMutation(projectId, (userId: string) => api.members.remove(projectId, userId));
