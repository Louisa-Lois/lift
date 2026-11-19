import type { Database } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabasesSection } from "@/components/databases-section";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { databases: { create: vi.fn(), delete: vi.fn(), credentials: vi.fn() } },
}));

const projectId = fixtures.fixtureIds.project;
const ready: Database = fixtures.database;

function renderSection(databases: Database[], canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DatabasesSection projectId={projectId} databases={databases} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.databases.create).mockResolvedValue({ ...ready, status: "provisioning" });
  vi.mocked(api.databases.delete).mockResolvedValue({ ...ready, status: "deleting" });
  vi.mocked(api.databases.credentials).mockResolvedValue(fixtures.databaseCredentials);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DatabasesSection", () => {
  it("adds the project's Postgres", async () => {
    renderSection([]);
    fireEvent.click(screen.getByRole("button", { name: "Add Postgres" }));
    await waitFor(() => expect(api.databases.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.databases.create).mock.calls[0]).toEqual([
      projectId,
      { type: "postgres", name: undefined },
    ]);
  });

  it("shows a database's status, and offers no second Postgres", () => {
    renderSection([
      ready,
      { ...ready, id: "db_eeeeeeeeeeeeeeeeeeeeeeee", name: "other", status: "provisioning" },
    ]);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Provisioning")).toBeTruthy();
    expect(screen.getByText(/Sets DATABASE_URL on this project's services/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Postgres" })).toBeNull();
  });

  it("gives viewers nothing to change or reveal", () => {
    renderSection([ready], false);
    expect(screen.getByText(ready.name)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Credentials" })).toBeNull();
  });

  it("deletes only once the name is typed", async () => {
    renderSection([ready]);
    fireEvent.click(screen.getByRole("button", { name: `Delete ${ready.name}` }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Delete database" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), { target: { value: "wrong" } });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/to confirm/), {
      target: { value: ready.name },
    });
    expect(confirm.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.databases.delete).toHaveBeenCalledWith(ready.id));
  });

  it("hides the password in the credentials until asked", async () => {
    renderSection([ready]);
    fireEvent.click(screen.getByRole("button", { name: "Credentials" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Password");
    const { password } = fixtures.databaseCredentials;
    expect(dialog.textContent).not.toContain(password);
    expect(api.databases.credentials).toHaveBeenCalledWith(ready.id);
    fireEvent.click(within(dialog).getByRole("button", { name: "Show the password" }));
    expect(dialog.textContent).toContain(password);
  });
});
