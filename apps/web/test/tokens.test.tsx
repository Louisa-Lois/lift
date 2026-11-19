import { CreateTokenBody } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewTokenDialog } from "@/components/new-token-dialog";
import { TokenTable } from "@/components/token-table";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { tokens: { list: vi.fn(), create: vi.fn(), revoke: vi.fn() } },
}));

// Radix measures its radio buttons with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const plaintext = fixtures.createdApiToken.token;

function renderWithClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return queryClient;
}

beforeEach(() => {
  vi.mocked(api.tokens.list).mockResolvedValue(fixtures.page(fixtures.apiTokens));
  vi.mocked(api.tokens.create).mockResolvedValue(fixtures.createdApiToken);
  vi.mocked(api.tokens.revoke).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function createToken(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "New token" }));
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: name } });
}

describe("NewTokenDialog", () => {
  it("creates a Deploy token by default and shows it once, then forgets it", async () => {
    const queryClient = renderWithClient(
      <NewTokenDialog trigger={<button type="button">New token</button>} />,
    );
    await createToken("laptop");
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));

    await waitFor(() => expect(api.tokens.create).toHaveBeenCalledTimes(1));
    expect(CreateTokenBody.parse(vi.mocked(api.tokens.create).mock.calls[0]?.[0])).toEqual({
      name: "laptop",
      scopes: ["deploy"],
    });
    const shown = (await screen.findByLabelText("Your new token")) as HTMLInputElement;
    expect(shown.value).toBe(plaintext);
    expect(screen.getByText("Copy it now. Lift shows it only once.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByLabelText("Your new token")).toBeNull());
    expect(document.body.innerHTML).not.toContain(plaintext);
    const cached = JSON.stringify([
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
      queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.data),
    ]);
    expect(cached).not.toContain(plaintext);
  });

  it("sends the scope you pick", async () => {
    renderWithClient(<NewTokenDialog trigger={<button type="button">New token</button>} />);
    await createToken("ci");
    fireEvent.click(screen.getByRole("radio", { name: /Admin/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(api.tokens.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.tokens.create).mock.calls[0]?.[0]).toEqual({
      name: "ci",
      scopes: ["admin"],
    });
  });

  it("needs a name", async () => {
    renderWithClient(<NewTokenDialog trigger={<button type="button">New token</button>} />);
    await createToken("");
    fireEvent.click(screen.getByRole("button", { name: "Create token" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe("true"),
    );
    expect(api.tokens.create).not.toHaveBeenCalled();
  });
});

describe("TokenTable", () => {
  it("shows each token's prefix and scope, never the token", async () => {
    renderWithClient(<TokenTable />);
    const laptop = (await screen.findByText("laptop")).closest("tr") as HTMLElement;
    expect(within(laptop).getByText("lift_pat_7Qm…")).toBeTruthy();
    expect(within(laptop).getByText("Deploy")).toBeTruthy();
    const oldCi = screen.getByText("old ci").closest("tr") as HTMLElement;
    expect(within(oldCi).getByText("Revoked")).toBeTruthy();
    expect(within(oldCi).queryByRole("button", { name: /Revoke/ })).toBeNull();
  });

  it("asks before revoking", async () => {
    renderWithClient(<TokenTable />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke laptop" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Revoke laptop?")).toBeTruthy();
    expect(api.tokens.revoke).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(api.tokens.revoke).toHaveBeenCalledWith(fixtures.fixtureIds.tokens.laptop),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
});
