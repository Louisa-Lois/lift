import * as fixtures from "@lift/shared/fixtures";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectCard } from "@/components/project-card";
import { STATUS_STYLES } from "@/components/status-badge";

afterEach(cleanup);

const now = Date.parse("2026-11-19T12:00:00Z");

describe("ProjectCard", () => {
  it("names each service's status in text, so colour is never the only signal", () => {
    render(<ProjectCard project={fixtures.projectListItem} now={now} />);
    const services = screen.getByRole("list", { name: "Services" });
    for (const service of fixtures.projectListItem.services) {
      const label = service.status ? STATUS_STYLES[service.status].label : "Not deployed";
      expect(services.textContent).toContain(`${service.name}: ${label}`);
    }
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/p/${fixtures.project.id}`);
  });

  it("says when a project has nothing yet", () => {
    render(
      <ProjectCard
        project={{ ...fixtures.projectListItem, services: [], lastDeployedAt: null }}
        now={now}
      />,
    );
    expect(screen.getByText("No services yet")).toBeTruthy();
    expect(screen.getByText("Not deployed yet")).toBeTruthy();
  });

  it("shows your role on projects you don't own", () => {
    render(<ProjectCard project={{ ...fixtures.projectListItem, role: "viewer" }} now={now} />);
    expect(screen.getByText("Viewer")).toBeTruthy();
  });
});
