import { LiftApiError } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewServiceFlow } from "@/components/new-service-flow";
import { api } from "@/lib/api";

const push = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => search,
}));
vi.mock("@/lib/api", () => ({
  api: {
    github: { repos: vi.fn(), branches: vi.fn() },
    plans: { create: vi.fn() },
    projects: { list: vi.fn() },
  },
}));

function renderFlow() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NewServiceFlow />
    </QueryClientProvider>,
  );
}

/** Picks lift-demo/next-hello from the repo list. */
async function pickRepo() {
  fireEvent.click(await screen.findByText("next-hello"));
  await screen.findByText("How should Lift set it up?");
}

const continueWithAi = () => screen.getByRole("button", { name: "Continue with AI" });

beforeEach(() => {
  search = new URLSearchParams();
  vi.mocked(api.github.repos).mockResolvedValue(fixtures.page(fixtures.githubRepos));
  vi.mocked(api.plans.create).mockResolvedValue(fixtures.onboardingPlan);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Continue with AI", () => {
  it("asks for a plan of the picked repo's default branch, then opens its review", async () => {
    search = new URLSearchParams({ project: fixtures.project.id });
    renderFlow();
    await pickRepo();
    fireEvent.click(continueWithAi());
    await waitFor(() => expect(api.plans.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.plans.create).mock.calls[0]?.[0]).toEqual({
      owner: "lift-demo",
      repo: "next-hello",
      branch: "main",
    });
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        `/new/plan/${fixtures.onboardingPlan.id}?project=${fixtures.project.id}`,
      ),
    );
  });

  it("says why it couldn't plan, and offers to try again", async () => {
    vi.mocked(api.plans.create).mockRejectedValue(
      new LiftApiError({
        type: "about:blank",
        title: "Too many requests",
        status: 429,
        detail: "You've used today's AI budget for plans.",
        code: "rate_limited",
      }),
    );
    renderFlow();
    await pickRepo();
    fireEvent.click(continueWithAi());
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "You've used today's AI budget for plans. You can still configure it manually.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
