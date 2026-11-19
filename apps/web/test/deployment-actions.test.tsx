import type { Deployment, DeploymentStatus, Service } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancelDeploymentButton, RestartServiceButton } from "@/components/deployment-actions";
import { ServiceDeployments } from "@/components/service-deployments";
import { api } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/api", () => ({
  api: {
    deployments: { list: vi.fn(), rollback: vi.fn(), cancel: vi.fn(), create: vi.fn() },
    services: { restart: vi.fn() },
  },
}));

const service: Service = fixtures.services.web;
const base = fixtures.deployments.web[0] as Deployment;
let minute = 0;
/** One of the service's deployments, each newer than the last. */
function deployment(status: DeploymentStatus, name: string, image = true): Deployment {
  minute += 1;
  const id = `dep_${name.padEnd(24, "0")}`;
  const at = new Date(Date.UTC(2026, 10, 19, 9, minute)).toISOString();
  return {
    ...base,
    id,
    status,
    commitSha: `${name}${"0".repeat(40 - name.length)}`,
    imageTag: image ? `lift/${service.id}:${id}` : null,
    queuedAt: at,
    createdAt: at,
  };
}

minute = 0;
const gone = deployment("superseded", "aaaaaa");
const kept = deployment("superseded", "bbbbbb");
const third = deployment("superseded", "cccccc");
const failed = deployment("failed", "dddddd", false);
const active = deployment("active", "eeeeee");
const building = deployment("building", "ffffff", false);
/** Newest first, as the API lists them. Lift keeps eeeeee's, cccccc's and bbbbbb's images. */
const all = [building, active, failed, third, kept, gone];

function renderList(deployments: Deployment[], canEdit = true) {
  vi.mocked(api.deployments.list).mockResolvedValue(fixtures.page(deployments));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ServiceDeployments service={service} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

function renderAlone(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

async function openMenu(sha: string) {
  const trigger = await screen.findByRole("button", { name: `More for deployment ${sha}` });
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.findByRole("menu");
}

beforeEach(() => {
  vi.mocked(api.deployments.rollback).mockResolvedValue({
    ...kept,
    id: "dep_rollback0000000000000000",
    status: "deploying",
    trigger: "rollback",
  });
  vi.mocked(api.deployments.cancel).mockResolvedValue({ ...building, status: "canceled" });
  vi.mocked(api.services.restart).mockResolvedValue(service);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a deployment row's menu", () => {
  it("offers rollback where Lift keeps the image, and says what it does first", async () => {
    renderList(all);
    const menu = await openMenu("bbbbbb0");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Rollback to this/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(`Roll back ${service.name} to bbbbbb0?`)).toBeTruthy();
    expect(dialog.textContent).toContain("today's variables and settings");
    // A build is running, and the dialog says it will still land.
    expect(dialog.textContent).toContain("The build in progress will still go live");
    expect(api.deployments.rollback).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Roll back" }));
    await waitFor(() => expect(api.deployments.rollback).toHaveBeenCalledWith(kept.id));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("says why not where it can't", async () => {
    renderList(all);
    const menu = await openMenu("aaaaaa0");
    const item = within(menu).getByRole("menuitem", { name: /Rollback to this/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain("Lift keeps the images of a service's last 3 builds");
    cleanup();
    renderList(all);
    const live = await openMenu("eeeeee0");
    expect(within(live).getByRole("menuitem", { name: /Rollback to this/ }).textContent).toContain(
      "This deployment is live now.",
    );
  });

  it("offers a viewer only the logs and the ID", async () => {
    renderList(all, false);
    const menu = await openMenu("bbbbbb0");
    expect(within(menu).queryByRole("menuitem", { name: /Rollback/ })).toBeNull();
    expect(within(menu).getByRole("menuitem", { name: /View logs/ })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: /Copy ID/ })).toBeTruthy();
  });
});

describe("cancel and restart", () => {
  it("cancel asks first, with a way to keep it", async () => {
    renderAlone(<CancelDeploymentButton deployment={building} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("The build stops, and what's live now keeps running.");
    expect(within(dialog).getByRole("button", { name: "Keep it" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel deployment" }));
    await waitFor(() => expect(api.deployments.cancel).toHaveBeenCalledWith(building.id));
  });

  it("restart says the app is down for a few seconds", async () => {
    renderAlone(<RestartServiceButton serviceId={service.id} serviceName={service.name} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("down for a few seconds");
    expect(dialog.textContent).toContain("Variable changes need a deploy.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(api.services.restart).toHaveBeenCalledWith(service.id));
  });
});
