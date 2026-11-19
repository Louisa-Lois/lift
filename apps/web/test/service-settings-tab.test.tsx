import { LiftApiError } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceSettingsTab } from "@/components/service-settings-tab";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({ api: { services: { update: vi.fn() } } }));

const service = fixtures.services.web;

function renderTab(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ServiceSettingsTab service={service} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

const toggle = () => screen.getByRole("switch", { name: "Autofix" });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the autofix switch", () => {
  it("shows the service's setting, and turns it off", async () => {
    vi.mocked(api.services.update).mockResolvedValue({ ...service, autofix: false });
    renderTab();
    expect(toggle().getAttribute("aria-checked")).toBe(String(service.autofix));
    fireEvent.click(toggle());
    await waitFor(() =>
      expect(api.services.update).toHaveBeenCalledWith(service.id, { autofix: false }),
    );
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });

  it("goes back when the API refuses", async () => {
    vi.mocked(api.services.update).mockRejectedValue(
      new LiftApiError({
        type: "about:blank",
        title: "Not allowed",
        status: 403,
        detail: "Only editors can change settings.",
        code: "forbidden",
      }),
    );
    renderTab();
    fireEvent.click(toggle());
    await waitFor(() => expect(toggle().getAttribute("aria-checked")).toBe("true"));
  });

  it("is read-only for viewers", () => {
    renderTab(false);
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Only the project's editors can change this.")).toBeTruthy();
  });
});
