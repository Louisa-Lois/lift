import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/** BE-17: the files the editor lists, at the service's branch. */
export function useEditorTree(serviceId: string) {
  return useQuery({
    queryKey: queryKeys.editorTree(serviceId),
    queryFn: () => api.editor.tree(serviceId),
    staleTime: 60_000,
  });
}

/**
 * BE-18: the files with drafts. The live text is on the collab server, so this asks every few
 * seconds while the page is on screen; a commit or discard refreshes it at once.
 */
export function useEditorChanges(serviceId: string) {
  return useQuery({
    queryKey: queryKeys.editorChanges(serviceId),
    queryFn: () => api.editor.changes(serviceId),
    refetchInterval: 3_000,
  });
}

export function useCommitChanges(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { message: string; paths?: string[] }) => api.editor.commit(serviceId, body),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.editorChanges(serviceId) }),
  });
}

export function useDiscardChanges(serviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paths?: string[]) => api.editor.discard(serviceId, paths ? { paths } : {}),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.editorChanges(serviceId) }),
  });
}
