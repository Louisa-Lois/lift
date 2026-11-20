import type { ProjectRole } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
vi.mock("@/lib/api", () => ({ api: { projects: { get: vi.fn() }, editor: { tree: vi.fn() } } }));

const service = fixtures.services.api;
const person = (n: number) => ({
  self: n === 0,
  user: {
    ...fixtures.editorSession.user,
    id: `usr_${String(n).padStart(24, "0")}`,
    name: `Person ${n}`,
  },
});

function renderEditor(role: ProjectRole = "owner") {
  vi.mocked(api.projects.get).mockResolvedValue({ ...fixtures.project, role });
  vi.mocked(api.editor.tree).mockResolvedValue(fixtures.editorTree);
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
    expect(screen.getByRole("tab", { name: "server.js", selected: true })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("tab", { name: "server.js" }));
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
});
