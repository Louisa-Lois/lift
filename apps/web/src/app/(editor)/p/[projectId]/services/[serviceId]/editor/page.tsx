import type { Metadata } from "next";
import { EditorScreen } from "@/components/editor/editor-screen";

export const metadata: Metadata = { title: "Editor · Lift" };

export default async function EditorPage({
  params,
}: PageProps<"/p/[projectId]/services/[serviceId]/editor">) {
  const { projectId, serviceId } = await params;
  return <EditorScreen projectId={projectId} serviceId={serviceId} />;
}
