import type { ApplyPlanResponse } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyBody, landingFor, PlanReview } from "@/components/plan-review";
import { api } from "@/lib/api";

const push = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => search,
}));
vi.mock("@/lib/api", () => ({
  api: {
    plans: { get: vi.fn(), apply: vi.fn() },
    projects: { list: vi.fn() },
  },
}));

const plan = fixtures.onboardingPlan;
const applied: ApplyPlanResponse = {
  project: fixtures.project,
  serviceId: fixtures.fixtureIds.services.web,
};

function renderReview() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlanReview planId={plan.id} />
    </QueryClientProvider>,
  );
}

const approve = () => screen.getByRole("button", { name: "Approve and deploy" });
const input = (key: string) => screen.getByLabelText(key) as HTMLInputElement;

beforeEach(() => {
  search = new URLSearchParams();
  vi.mocked(api.plans.get).mockResolvedValue(plan);
  vi.mocked(api.plans.apply).mockResolvedValue(applied);
  vi.mocked(api.projects.list).mockResolvedValue(fixtures.page([fixtures.projectListItem]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the plan review", () => {
  it("shows the summary, the warnings and who fills each variable", async () => {
    renderReview();
    expect(await screen.findByText(plan.summary)).toBeTruthy();
    expect(screen.getByText(plan.warnings[0] ?? "")).toBeTruthy();
    expect(screen.getByText("High confidence")).toBeTruthy();
    // DATABASE_URL and SESSION_SECRET are Lift's; NODE_ENV has a default; two are the user's.
    expect(screen.getAllByText("Lift fills this")).toHaveLength(2);
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.getByText("You provide")).toBeTruthy();
    expect(screen.getByText("You provide (optional)")).toBeTruthy();
    expect(input("NODE_ENV").value).toBe("production");
    expect(input("STRIPE_SECRET_KEY").type).toBe("password");
  });

  it("keeps Approve and deploy off until every required value is filled, then applies and opens the deployment", async () => {
    renderReview();
    await screen.findByText(plan.summary);
    expect((approve() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Fill in STRIPE_SECRET_KEY first.")).toBeTruthy();
    fireEvent.change(input("STRIPE_SECRET_KEY"), { target: { value: "sk_test_typed" } });
    expect((approve() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(approve());
    await waitFor(() => expect(api.plans.apply).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.plans.apply).mock.calls[0]).toEqual([
      plan.id,
      {
        projectName: "express-postgres",
        databases: ["notes-db"],
        values: [{ service: "api", key: "STRIPE_SECRET_KEY", value: "sk_test_typed" }],
      },
    ]);
    await waitFor(() => expect(push).toHaveBeenCalledWith(landingFor(applied)));
  });

  it("asks for DATABASE_URL once the database is turned off", async () => {
    renderReview();
    await screen.findByText(plan.summary);
    fireEvent.change(input("STRIPE_SECRET_KEY"), { target: { value: "sk_test_typed" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getAllByText("Lift fills this")).toHaveLength(1);
    expect((approve() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input("DATABASE_URL"), { target: { value: "postgres://elsewhere/db" } });
    expect((approve() as HTMLButtonElement).disabled).toBe(false);
  });

  it("adds the service to the project from ?project=", async () => {
    search = new URLSearchParams({ project: fixtures.project.id });
    renderReview();
    expect(await screen.findByText(fixtures.projectListItem.name)).toBeTruthy();
    expect(screen.queryByLabelText("New project")).toBeNull();
  });

  it("puts an API field error on its input", async () => {
    vi.mocked(api.plans.apply).mockRejectedValue(
      new (await import("@lift/shared")).LiftApiError({
        type: "about:blank",
        title: "Invalid request",
        status: 400,
        detail: "Some values are missing.",
        code: "validation_failed",
        fields: { "values.STRIPE_SECRET_KEY": "Required" },
      }),
    );
    renderReview();
    await screen.findByText(plan.summary);
    fireEvent.change(input("STRIPE_SECRET_KEY"), { target: { value: "x" } });
    fireEvent.click(approve());
    expect(await screen.findByText("Required")).toBeTruthy();
  });

  it("says when the plan isn't there", async () => {
    vi.mocked(api.plans.get).mockRejectedValue(
      new (await import("@lift/shared")).LiftApiError({
        type: "about:blank",
        title: "Not found",
        status: 404,
        detail: "No plan.",
        code: "not_found",
      }),
    );
    renderReview();
    expect(await screen.findByText("This plan isn't available")).toBeTruthy();
  });
});

describe("the apply body", () => {
  const service = {
    name: "api",
    rootDir: ".",
    buildCommand: "",
    startCommand: "node server.js",
    port: "3000",
    healthcheckPath: "/health",
  };

  it("sends only what changed, and an edited default", () => {
    expect(
      applyBody(plan, {
        projectId: null,
        projectName: " Notes ",
        service: { ...service, port: "8080", startCommand: " " },
        databasesOn: [true],
        values: { NODE_ENV: "staging", STRIPE_SECRET_KEY: "sk", SENTRY_DSN: "  " },
      }),
    ).toEqual({
      projectName: "Notes",
      service: { port: 8080, startCommand: null },
      databases: ["notes-db"],
      values: [
        { service: "api", key: "NODE_ENV", value: "staging" },
        { service: "api", key: "STRIPE_SECRET_KEY", value: "sk" },
      ],
    });
  });

  it("names the project to join instead of a new one, and drops a database left off", () => {
    const body = applyBody(plan, {
      projectId: fixtures.project.id,
      projectName: "ignored",
      service,
      databasesOn: [false],
      values: { NODE_ENV: "production", DATABASE_URL: "postgres://x/db", STRIPE_SECRET_KEY: "sk" },
    });
    expect(body).toMatchObject({ projectId: fixtures.project.id, databases: [] });
    expect(body).not.toHaveProperty("projectName");
    expect(body.values.map((value) => value.key)).toEqual(["DATABASE_URL", "STRIPE_SECRET_KEY"]);
  });
});
