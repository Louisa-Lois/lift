import { useQuery } from "@tanstack/react-query";
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
