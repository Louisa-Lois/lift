import { CreateServiceBody, LiftApiError, type ProjectListItem } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialBranch, NewServiceForm } from "@/components/new-service-form";
import type { PickedRepo } from "@/components/repo-picker";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    projects: { list: vi.fn(), create: vi.fn() },
    github: { branches: vi.fn() },
    services: { create: vi.fn() },
  },
}));

// Radix measures its radio buttons with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const repo: PickedRepo = {
  owner: "lift-demo",
  name: "next-hello",
  defaultBranch: "main",
  private: false,
};

function renderForm(projectsYouCanSee: ProjectListItem[] = [fixtures.projectListItem]) {
  vi.mocked(api.projects.list).mockResolvedValue(fixtures.page(projectsYouCanSee));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <NewServiceForm repo={repo} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { onCreated };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Create and deploy" }));

/** The only project you can deploy into is chosen for you once the projects load. */
async function projectChosen() {
  await waitFor(() => expect(field("Project").value).toBe(fixtures.project.id));
}

beforeEach(() => {
  vi.mocked(api.github.branches).mockResolvedValue(
    fixtures.page(fixtures.githubBranches["lift-demo/next-hello"] ?? []),
  );
  vi.mocked(api.services.create).mockResolvedValue(fixtures.services.web);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NewServiceForm", () => {
  it("creates the service with deploy: true, in a body the API accepts", async () => {
    const { onCreated } = renderForm();
    await projectChosen();
    await screen.findByRole("option", { name: "feature/checkout" });
    expect(field("Branch").value).toBe("main");
    expect(field("Service name").value).toBe("next-hello");

    fireEvent.change(field("Branch"), { target: { value: "feature/checkout" } });
    fireEvent.change(field("Root directory"), { target: { value: "apps/web" } });
    fireEvent.change(field("Port"), { target: { value: "8080" } });
    submit();

    await waitFor(() => expect(api.services.create).toHaveBeenCalledTimes(1));
    const [projectId, body] = vi.mocked(api.services.create).mock.calls[0] ?? [];
    expect(projectId).toBe(fixtures.project.id);
    expect(CreateServiceBody.parse(body)).toEqual({
      name: "next-hello",
      repo: { owner: "lift-demo", name: "next-hello" },
      branch: "feature/checkout",
      rootDir: "apps/web",
      builder: "railpack",
      port: 8080,
      deploy: true,
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(fixtures.services.web));
  });

  it("puts the API's field errors on their inputs", async () => {
    vi.mocked(api.services.create).mockRejectedValue(
      new LiftApiError({
        type: "about:blank",
        title: "Some fields need fixing",
        status: 422,
        detail: "Check the highlighted fields.",
        code: "validation_failed",
        fields: {
          branch: "lift-demo/next-hello has no branch called main",
          "repo.name": "Lift can't read this repo with your GitHub account",
        },
      }),
    );
    renderForm();
    await projectChosen();
    submit();

    expect(await screen.findByText("lift-demo/next-hello has no branch called main")).toBeTruthy();
    expect(field("Branch").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(
      "Lift can't read this repo with your GitHub account",
    );
  });

  it("checks the fields before calling the API", async () => {
    renderForm();
    await projectChosen();
    fireEvent.change(field("Service name"), { target: { value: "   " } });
    fireEvent.change(field("Port"), { target: { value: "70000" } });
    fireEvent.change(field("Root directory"), { target: { value: "/srv/app" } });
    submit();

    expect(await screen.findByText("Required")).toBeTruthy();
    expect(screen.getByText("Use 65535 or less")).toBeTruthy();
    expect(screen.getByText(/relative to the repo root/)).toBeTruthy();
    expect(api.services.create).not.toHaveBeenCalled();
  });

  it("creates a project from the form without submitting the form", async () => {
    const created = { ...fixtures.project, id: "prj_newnewnewnewnewnewnewnewn", name: "Shop v2" };
    vi.mocked(api.projects.create).mockResolvedValue({ ...created, services: [] });
    renderForm();
    await projectChosen();
    vi.mocked(api.projects.list).mockResolvedValue(
      fixtures.page([
        { ...fixtures.projectListItem, ...created, services: [] },
        fixtures.projectListItem,
      ]),
    );

    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Shop v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(field("Project").value).toBe(created.id));
    expect(api.projects.create).toHaveBeenCalledWith({ name: "Shop v2" });
    expect(api.services.create).not.toHaveBeenCalled();
  });

  it("asks for a project when you can't deploy into any of yours", async () => {
    renderForm([{ ...fixtures.projectListItem, role: "viewer" }]);
    await screen.findByRole("option", { name: "No projects yet: create one" });
    expect(screen.queryByRole("option", { name: fixtures.project.name })).toBeNull();
    submit();

    expect(await screen.findByText("Choose a project")).toBeTruthy();
    expect(api.services.create).not.toHaveBeenCalled();
  });
});

describe("initialBranch", () => {
  it.each([
    ["main", ["dev", "main"], "main"],
    ["trunk", ["main", "trunk"], "trunk"],
    ["gone", ["dev", "master"], "master"],
    [null, ["dev", "main"], "main"],
    [null, ["dev", "release"], "dev"],
    ["main", [], "main"],
    [null, [], ""],
  ])("starts %s with %j on %s", (defaultBranch, branches, expected) => {
    expect(initialBranch(defaultBranch, branches)).toBe(expected);
  });
});
