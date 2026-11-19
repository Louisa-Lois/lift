import { LiftApiError, type Service, type Variable } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VariablesTab } from "@/components/variables-tab";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    variables: { list: vi.fn(), upsert: vi.fn() },
    deployments: { create: vi.fn() },
  },
}));

const DEPLOYED_AT = "2026-11-19T09:00:00Z";
const SAVED_AT = "2026-11-19T10:00:00Z";
const service: Service = {
  ...fixtures.services.web,
  latestDeployment: fixtures.services.web.latestDeployment
    ? { ...fixtures.services.web.latestDeployment, createdAt: DEPLOYED_AT }
    : null,
};
const masked = fixtures.variables.web;
const plain = fixtures.revealedVariables.web;
const plainValue = (key: string) => plain.find((variable) => variable.key === key)?.value ?? "";

function renderTab(canEdit = true, onDeployed = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <VariablesTab service={service} canEdit={canEdit} onDeployed={onDeployed} />
    </QueryClientProvider>,
  );
  return { onDeployed };
}

const row = async (key: string) =>
  (await screen.findByText(key, { selector: "code" })).closest("li") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
  vi.mocked(api.variables.list).mockImplementation(async (_id, params) =>
    fixtures.page(params?.reveal ? plain : masked),
  );
  vi.mocked(api.deployments.create).mockResolvedValue(fixtures.deployments.web[0] as never);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("VariablesTab", () => {
  it("shows a viewer masked values and where they came from, with nothing to change", async () => {
    renderTab(false);
    const database = await row("DATABASE_URL");
    expect(within(database).getByText("database")).toBeTruthy();
    expect(within(await row("RAILPACK_NODE_VERSION")).getByText("agent")).toBeTruthy();
    expect(within(await row("NEXT_PUBLIC_API_URL")).getByText("you")).toBeTruthy();
    expect(document.body.textContent).not.toContain(plainValue("SESSION_SECRET"));
    expect(screen.queryByRole("button", { name: /Show / })).toBeNull();
    expect(screen.queryByLabelText("New variable's key")).toBeNull();
    expect(api.variables.list).toHaveBeenCalledTimes(1);
  });

  it("reveals a value only when an editor asks", async () => {
    renderTab();
    const secret = await row("SESSION_SECRET");
    expect(secret.textContent).not.toContain(plainValue("SESSION_SECRET"));
    fireEvent.click(within(secret).getByRole("button", { name: "Show SESSION_SECRET" }));
    await waitFor(() => expect(secret.textContent).toContain(plainValue("SESSION_SECRET")));
    expect(api.variables.list).toHaveBeenCalledWith(service.id, { reveal: true });
  });

  it("stages edits, deletions and new keys, saves them in one PUT, then says they're staged", async () => {
    vi.mocked(api.variables.upsert).mockImplementation(async () => ({
      requiresRedeploy: true as const,
      variables: [
        ...masked
          .filter((variable) => variable.key !== "RAILPACK_NODE_VERSION")
          .map((variable) =>
            variable.key === "NEXT_PUBLIC_API_URL"
              ? { ...variable, updatedAt: SAVED_AT }
              : variable,
          ),
        { ...(masked[0] as Variable), key: "FEATURE_FLAG", value: "••••on", updatedAt: SAVED_AT },
      ],
    }));
    renderTab();
    fireEvent.click(
      within(await row("NEXT_PUBLIC_API_URL")).getByRole("button", {
        name: "Edit NEXT_PUBLIC_API_URL",
      }),
    );
    fireEvent.change(screen.getByLabelText("New value for NEXT_PUBLIC_API_URL"), {
      target: { value: "https://api.new.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete RAILPACK_NODE_VERSION" }));
    fireEvent.change(screen.getByLabelText("New variable's key"), {
      target: { value: "FEATURE_FLAG" },
    });
    fireEvent.change(screen.getByLabelText("New variable's value"), { target: { value: "on" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("3 unsaved changes")).toBeTruthy();
    expect(api.variables.upsert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.variables.upsert).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.variables.upsert).mock.calls[0]).toEqual([
      service.id,
      {
        variables: {
          NEXT_PUBLIC_API_URL: "https://api.new.example",
          RAILPACK_NODE_VERSION: null,
          FEATURE_FLAG: "on",
        },
      },
    ]);
    // Two values saved after the last deploy, and one deletion.
    expect(await screen.findByText("3 changes staged. Deploy to apply.")).toBeTruthy();
    expect(screen.queryByText(/unsaved/)).toBeNull();
  });

  it("refuses PORT and LIFT_ keys before anything is sent", async () => {
    renderTab();
    await row("DATABASE_URL");
    fireEvent.change(screen.getByLabelText("New variable's key"), { target: { value: "PORT" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toBe(
      "PORT is set by Lift: change the service's port instead",
    );
    expect(screen.queryByText(/unsaved/)).toBeNull();
  });

  it("puts the API's message for a key on its row", async () => {
    vi.mocked(api.variables.upsert).mockRejectedValue(
      new LiftApiError({
        type: "about:blank",
        title: "Invalid request",
        status: 400,
        detail: "Check the variables.",
        code: "validation_failed",
        fields: { "variables.FEATURE_FLAG": "That value is too long" },
      }),
    );
    renderTab();
    await row("DATABASE_URL");
    fireEvent.change(screen.getByLabelText("New variable's key"), {
      target: { value: "FEATURE_FLAG" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const flag = await row("FEATURE_FLAG");
    expect(await within(flag).findByText("That value is too long")).toBeTruthy();
    expect(screen.getByText("1 unsaved change")).toBeTruthy();
  });

  it("deploys from the banner", async () => {
    vi.mocked(api.variables.list).mockResolvedValue(
      fixtures.page(masked.map((variable) => ({ ...variable, updatedAt: SAVED_AT }))),
    );
    const { onDeployed } = renderTab();
    const banner = await screen.findByText(`${masked.length} changes staged. Deploy to apply.`);
    fireEvent.click(
      within(banner.parentElement as HTMLElement).getByRole("button", { name: "Deploy" }),
    );
    await waitFor(() => expect(api.deployments.create).toHaveBeenCalledWith(service.id, {}));
    await waitFor(() => expect(onDeployed).toHaveBeenCalled());
  });
});
