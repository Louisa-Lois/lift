import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "@/app/login/login-screen";
import { AppShell } from "@/components/app-shell";
import { api } from "@/lib/api";

// Louisa's wordmark (public/brand, UI-01) on the screens that are Hakim's: the top bar and the
// sign-in page. brand-files.test.ts checks the favicon and that every brand file exists.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/api", () => ({
  api: {
    me: vi.fn(),
    logout: vi.fn(),
    urls: { githubSignIn: () => "/api/v1/auth/github/start" },
  },
}));

const WORDMARK = "/brand/lift-wordmark-dark.svg";

function renderWithQueries(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  // Nobody is signed in: the top bar has no user menu, and the sign-in page stays put.
  vi.mocked(api.me).mockRejectedValue(new Error("401"));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the wordmark", () => {
  it("is in the top bar, linking to the projects", () => {
    renderWithQueries(
      <AppShell>
        <p>Page</p>
      </AppShell>,
    );
    const home = screen.getByRole("link", { name: "Lift" });
    expect(home.getAttribute("href")).toBe("/projects");
    expect(home.querySelector("img")?.getAttribute("src")).toBe(WORDMARK);
  });

  it("is the sign-in page's heading", () => {
    renderWithQueries(<LoginScreen />);
    const heading = screen.getByRole("heading", { level: 1, name: "Lift" });
    expect(heading.querySelector("img")?.getAttribute("src")).toBe(WORDMARK);
  });
});
