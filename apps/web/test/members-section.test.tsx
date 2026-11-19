import { LiftApiError } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MembersSection } from "@/components/members-section";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { members: { list: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn() } },
}));

const projectId = fixtures.project.id;
const [, editor] = fixtures.members;

function renderSection(isOwner = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MembersSection projectId={projectId} isOwner={isOwner} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.members.list).mockResolvedValue(fixtures.page(fixtures.members));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the members section", () => {
  it("lists everyone, and lets the owner add people by GitHub login", async () => {
    vi.mocked(api.members.add).mockResolvedValue({
      ...editor,
      userId: "usr_bbbbbbbbbbbbbbbbbbbbbbbb",
    } as never);
    renderSection();
    expect(await screen.findByText("@ama-owusu")).toBeTruthy();
    expect(screen.getByText("@kwame-asante")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("GitHub login"), { target: { value: " davidbuah " } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "viewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(api.members.add).toHaveBeenCalledWith(projectId, {
        login: "davidbuah",
        role: "viewer",
      }),
    );
  });

  it("shows why someone can't be added, on the login field", async () => {
    vi.mocked(api.members.add).mockRejectedValue(
      new LiftApiError({
        type: "about:blank",
        title: "Not found",
        status: 404,
        detail: "nobody hasn't signed in to Lift yet.",
        code: "not_found",
        fields: { login: "Hasn't signed in to Lift yet" },
      }),
    );
    renderSection();
    await screen.findByText("@ama-owusu");
    fireEvent.change(screen.getByLabelText("GitHub login"), { target: { value: "nobody" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Hasn't signed in to Lift yet")).toBeTruthy();
  });

  it("changes roles, and asks before removing", async () => {
    vi.mocked(api.members.update).mockResolvedValue(editor as never);
    vi.mocked(api.members.remove).mockResolvedValue(undefined);
    renderSection();
    await screen.findByText("@kwame-asante");
    fireEvent.change(screen.getByLabelText("Role of kwame-asante"), {
      target: { value: "viewer" },
    });
    await waitFor(() =>
      expect(api.members.update).toHaveBeenCalledWith(projectId, editor?.userId, {
        role: "viewer",
      }),
    );
    const row = screen.getByText("@kwame-asante").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    expect(api.members.remove).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }),
    );
    await waitFor(() => expect(api.members.remove).toHaveBeenCalledWith(projectId, editor?.userId));
  });

  it("is read-only for everyone but the owner, and the owner's own row never changes", async () => {
    renderSection(false);
    await screen.findByText("@ama-owusu");
    expect(screen.queryByLabelText("GitHub login")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByLabelText(/Role of/)).toBeNull();
    cleanup();
    renderSection(true);
    await screen.findByText("@ama-owusu");
    expect(screen.queryByLabelText("Role of ama-owusu")).toBeNull();
  });
});
