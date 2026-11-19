import type { Metadata } from "next";
import { ProjectsGrid } from "@/components/projects-grid";

export const metadata: Metadata = { title: "Projects · Lift" };

export default function ProjectsPage() {
  return <ProjectsGrid />;
}
