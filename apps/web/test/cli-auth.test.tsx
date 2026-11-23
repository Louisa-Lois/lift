import { type ErrorCode, LiftApiError } from "@lift/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliApproval } from "@/components/cli-approval";
import { api } from "@/lib/api";

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));
vi.mock("@/lib/api", () => ({ api: { cliLogins: { approve: vi.fn(), deny: vi.fn() } } }));

const CODE = "BCDF-GHJK";

function renderPage(query: string) {
  search = new URLSearchParams(query);
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CliApproval />
    </QueryClientProvider>,
  );
}

const problem = (status: number, code: ErrorCode, detail: string) =>
  new LiftApiError({ type: "about:blank", title: "Not possible", status, code, detail });

beforeEach(() => {
  vi.mocked(api.cliLogins.approve).mockResolvedValue({ code: CODE, status: "approved" });
  vi.mocked(api.cliLogins.deny).mockResolvedValue({ code: CODE, status: "denied" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the CLI approval page", () => {
  it("shows the code to check against the terminal, and where to revoke the token", () => {
    renderPage(`code=${CODE}`);
    expect(screen.getByText("Login code")).toBeTruthy();
    expect(screen.getByText(CODE)).toBeTruthy();
    expect(screen.getByRole("link", { name: "API tokens" }).getAttribute("href")).toBe(
      "/account/tokens",
    );
  });

  it("approves the code and says the CLI is signed in", async () => {
    renderPage(`code=${CODE}`);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("The CLI is signed in")).toBeTruthy();
    expect(api.cliLogins.approve).toHaveBeenCalledWith(CODE);
    expect(api.cliLogins.deny).not.toHaveBeenCalled();
  });

  it("denies the code", async () => {
    renderPage(`code=${CODE}`);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(await screen.findByText("The CLI won't be signed in.")).toBeTruthy();
    expect(api.cliLogins.deny).toHaveBeenCalledWith(CODE);
    expect(api.cliLogins.approve).not.toHaveBeenCalled();
  });

  it.each([
    [404, "not_found", "No CLI login has this code. Run `lift login` again."],
    [409, "conflict", "This code expired. Run `lift login` again."],
  ] as const)(
    "says why a code can't be used (%i), with no buttons left",
    async (status, code, detail) => {
      vi.mocked(api.cliLogins.approve).mockRejectedValue(problem(status, code, detail));
      renderPage(`code=${CODE}`);
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      expect(await screen.findByText(detail)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    },
  );

  it("keeps the buttons when Lift doesn't answer, so you can try again", async () => {
    vi.mocked(api.cliLogins.approve).mockRejectedValueOnce(new TypeError("fetch failed"));
    renderPage(`code=${CODE}`);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Lift didn't answer");

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("The CLI is signed in")).toBeTruthy();
  });

  it.each(["", "code=", "code=AB"])("says a link without a real code (%j) has none", (query) => {
    renderPage(query);
    expect(screen.getByText("This link has no login code")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});
