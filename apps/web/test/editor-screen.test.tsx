import { LiftApiError, type ProjectEvent, type ProjectRole } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorScreen } from "@/components/editor/editor-screen";
import type { MonacoPaneProps } from "@/components/editor/monaco-pane";
import { api } from "@/lib/api";

// Monaco needs a real browser; the pane is checked in one (see the PR). Here it records its props.
const pane = vi.hoisted(() => ({ props: null as MonacoPaneProps | null }));
vi.mock("@/components/editor/lazy-monaco-pane", () => ({
  LazyMonacoPane: (props: MonacoPaneProps) => {
    pane.props = props;
    return <div data-testid="monaco" />;
  },
}));
vi.mock("@/lib/api", () => ({
  api: {
    me: vi.fn(),
    projects: { get: vi.fn() },
    members: { list: vi.fn() },
    editor: { tree: vi.fn(), changes: vi.fn() },
  },
}));
// The project's events: the test plays them through the callback the screen passes.
const events = vi.hoisted(() => ({ onEvent: null as null | ((event: ProjectEvent) => void) }));
vi.mock("@/lib/hooks/use-project-events", () => ({
  useProjectEvents: (_projectId: string, onEvent: (event: ProjectEvent) => void) => {
    events.onEvent = onEvent;
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const service = fixtures.services.api;
const person = (n: number) => ({
  self: n === 0,
  user: {
    ...fixtures.editorSession.user,
    id: `usr_${String(n).padStart(24, "0")}`,
    name: `Person ${n}`,
  },
});

function renderEditor(
  role: ProjectRole = "owner",
  changes = fixtures.editorChanges,
  /** What the file tree request fails with, instead of answering. */
  treeError?: unknown,
) {
  vi.mocked(api.me).mockResolvedValue(fixtures.me);
  vi.mocked(api.projects.get).mockResolvedValue({ ...fixtures.project, role });
  vi.mocked(api.members.list).mockResolvedValue(fixtures.page(fixtures.members));
  if (treeError) vi.mocked(api.editor.tree).mockRejectedValue(treeError);
  else vi.mocked(api.editor.tree).mockResolvedValue(fixtures.editorTree);
  vi.mocked(api.editor.changes).mockResolvedValue(fixtures.page(changes));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EditorScreen projectId={fixtures.project.id} serviceId={service.id} />
    </QueryClientProvider>,
  );
}

const inTree = (name: string) =>
  within(screen.getByRole("navigation", { name: "Files" })).getByRole("button", {
    name,
  });

async function openFile(path: string) {
  const parts = path.split("/");
  await screen.findByRole("navigation", { name: "Files" });
  await within(screen.getByRole("navigation", { name: "Files" })).findByRole("button", {
    name: parts[0],
  });
  for (const folder of parts.slice(0, -1)) fireEvent.click(inTree(folder));
  fireEvent.click(inTree(parts.at(-1) ?? ""));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  pane.props = null;
});

describe("the live editor", () => {
  it("lists the service's files, and opens one in a tab, live", async () => {
    renderEditor();
    await openFile("server.js");
    expect(screen.getByRole("tab", { name: /^server\.js/, selected: true })).toBeTruthy();
    expect(pane.props).toMatchObject({
      serviceId: service.id,
      paths: ["server.js"],
      active: "server.js",
    });
  });

  it("opens folders, and never opens binary or large files live", async () => {
    renderEditor();
    await openFile("public/logo.png");
    expect(screen.getByText("Can't edit binary files")).toBeTruthy();
    await openFile("data/seed.sql");
    expect(screen.getByText("Too large to edit here")).toBeTruthy();
    expect(pane.props).toMatchObject({ paths: [], active: null });
  });

  it("switches between tabs, and closing one shows its neighbour", async () => {
    renderEditor();
    await openFile("server.js");
    await openFile("package.json");
    expect(pane.props).toMatchObject({
      paths: ["server.js", "package.json"],
      active: "package.json",
    });
    fireEvent.click(screen.getByRole("tab", { name: /^server\.js/ }));
    expect(pane.props?.active).toBe("server.js");
    fireEvent.click(screen.getByRole("button", { name: "Close server.js" }));
    expect(pane.props).toMatchObject({ paths: ["package.json"], active: "package.json" });
  });

  it("shows the connection and who's in the file: five faces, then a count", async () => {
    renderEditor();
    await openFile("server.js");
    act(() =>
      pane.props?.onFileState("server.js", {
        connection: "connected",
        people: Array.from({ length: 7 }, (_, n) => person(n)),
      }),
    );
    expect(screen.getByRole("status").textContent).toContain("Connected");
    const faces = screen.getByRole("img", { name: /In this file/ });
    expect(faces.getAttribute("aria-label")).toBe(
      "In this file: Person 0 (you), Person 1, Person 2, Person 3, Person 4, Person 5, Person 6",
    );
    expect(within(faces).getByText("+2")).toBeTruthy();
  });

  it("is read-only for viewers", async () => {
    renderEditor("viewer");
    await openFile("server.js");
    expect(screen.getByText("Read-only")).toBeTruthy();
  });

  it("says why a file couldn't open live", async () => {
    renderEditor();
    await openFile("server.js");
    act(() =>
      pane.props?.onFileState("server.js", { connection: "disconnected", error: "This is a link" }),
    );
    expect(screen.getByText("Can't open this file")).toBeTruthy();
    expect(screen.getByText("This is a link")).toBeTruthy();
  });

  it("says why the editor couldn't open, in the API's words when it answered", async () => {
    const detail =
      "The editor reads the repo with the project owner's GitHub token, and GitHub refused it. Ask ama-owusu to sign out of Lift and sign in again.";
    const problem = (status: number, code: "github_error" | "not_found") =>
      new LiftApiError({ type: "about:blank", title: "Failed", status, detail, code });

    renderEditor("editor", [], problem(502, "github_error"));
    expect(await screen.findByText("Can't open the editor")).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    cleanup();

    renderEditor("editor", [], problem(404, "not_found"));
    expect(await screen.findByText("Nothing to edit here")).toBeTruthy();
    cleanup();

    renderEditor("editor", [], new TypeError("Failed to fetch"));
    expect(
      await screen.findByText("Lift didn't answer. Check your connection, then reload the page."),
    ).toBeTruthy();
  });

  it("counts the changes, dots changed tabs, and lists them in the rail", async () => {
    renderEditor();
    const changes = await screen.findByRole("button", { name: "Changes (2)" });
    await openFile("server.js");
    await openFile("package.json");
    const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
    expect(within(tab("server.js")).getByRole("img", { name: "Changed" })).toBeTruthy();
    expect(within(tab("package.json")).queryByRole("img", { name: "Changed" })).toBeNull();
    fireEvent.click(changes);
    const rail = screen.getByRole("complementary", { name: "Changes" });
    fireEvent.click(within(rail).getByTitle("src/routes/orders.js"));
    expect(pane.props?.active).toBe("src/routes/orders.js");
  });

  it("offers Commit & deploy to editors with changes, and never to viewers", async () => {
    renderEditor("owner", []);
    const commit = await screen.findByRole("button", { name: "Commit & deploy" });
    expect(commit.hasAttribute("disabled")).toBe(true);
    cleanup();
    renderEditor("viewer");
    await screen.findByRole("button", { name: "Changes (2)" });
    expect(screen.queryByRole("button", { name: "Commit & deploy" })).toBeNull();
  });

  it("says who committed, when someone else commits from the editor", async () => {
    renderEditor();
    await screen.findByRole("button", { name: "Changes (2)" });
    const [, kwame] = fixtures.members;
    act(() =>
      events.onEvent?.({
        id: "evt_000000000000000000000001",
        projectId: fixtures.project.id,
        actorType: "user",
        actorId: kwame?.userId ?? null,
        type: "editor.committed",
        createdAt: "2026-11-26T10:00:00Z",
        data: {
          id: "ecm_000000000000000000000001",
          serviceId: service.id,
          commitSha: "b".repeat(40),
          message: "Orders v2\n\nThe body.",
          paths: ["src/routes/orders.js", "server.js"],
          authorUserId: kwame?.userId ?? "",
          deploymentId: "dep_000000000000000000000001",
          createdAt: "2026-11-26T10:00:00Z",
        },
      }),
    );
    await vi.waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        "Kwame Asante committed 2 files",
        expect.objectContaining({ description: "Orders v2" }),
      ),
    );
  });
});
