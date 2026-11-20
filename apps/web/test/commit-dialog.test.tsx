import { LiftApiError } from "@lift/shared";
import * as fixtures from "@lift/shared/fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommitDialog } from "@/components/editor/commit-dialog";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({ api: { editor: { commit: vi.fn(), discard: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const projectId = fixtures.project.id;
const serviceId = fixtures.services.api.id;
const [serverJs, ordersJs] = fixtures.editorChanges;
const onOpenChange = vi.fn();

function renderDialog(changes = fixtures.editorChanges) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CommitDialog
        projectId={projectId}
        serviceId={serviceId}
        changes={changes}
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the commit dialog", () => {
  it("names a single file in the message, and links the toast to the deployment", async () => {
    vi.mocked(api.editor.commit).mockResolvedValue({
      commitSha: "c0ffee0".padEnd(40, "0"),
      deploymentId: "dep_000000000000000000000001",
    });
    renderDialog(serverJs ? [serverJs] : []);
    expect(screen.getByLabelText<HTMLInputElement>("Message").value).toBe("Update server.js");
    fireEvent.click(screen.getByRole("button", { name: "Commit & deploy" }));
    await waitFor(() =>
      expect(api.editor.commit).toHaveBeenCalledWith(serviceId, { message: "Update server.js" }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const [title, options] = vi.mocked(toast.success).mock.calls[0] ?? [];
    expect(title).toBe("Committed c0ffee0");
    (options as unknown as { action: { onClick: () => void } }).action.onClick();
    expect(push).toHaveBeenCalledWith(`/p/${projectId}/deployments/dep_000000000000000000000001`);
  });

  it("commits only the files left checked", async () => {
    vi.mocked(api.editor.commit).mockResolvedValue({
      commitSha: "a".repeat(40),
      deploymentId: "dep_000000000000000000000001",
    });
    renderDialog();
    expect(screen.getByLabelText<HTMLInputElement>("Message").value).toBe("Update 2 files");
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Orders v2" } });
    fireEvent.click(screen.getByLabelText(ordersJs?.path ?? ""));
    fireEvent.click(screen.getByRole("button", { name: "Commit & deploy" }));
    await waitFor(() =>
      expect(api.editor.commit).toHaveBeenCalledWith(serviceId, {
        message: "Orders v2",
        paths: ["server.js"],
      }),
    );
  });

  it("lists the files that changed on GitHub, and Discard and reload reloads them", async () => {
    vi.mocked(api.editor.commit).mockRejectedValue(
      new LiftApiError({
        type: "about:blank",
        title: "Conflict",
        status: 409,
        code: "conflict",
        detail: "Some files changed on GitHub since you opened them.",
        fields: { "server.js": "Changed on GitHub since you opened it" },
      }),
    );
    vi.mocked(api.editor.discard).mockResolvedValue({ paths: ["server.js"] });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Commit & deploy" }));
    expect(await screen.findByText("These files changed on GitHub")).toBeTruthy();
    expect(screen.getByText("Changed on GitHub since you opened it")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard and reload" }));
    await waitFor(() =>
      expect(api.editor.discard).toHaveBeenCalledWith(serviceId, { paths: ["server.js"] }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith("Reloaded server.js from GitHub");
  });

  it("keeps the dialog open on any other error, saying why", async () => {
    vi.mocked(api.editor.commit).mockRejectedValue(
      new LiftApiError({
        type: "about:blank",
        title: "Not allowed",
        status: 403,
        code: "forbidden",
        detail: "Your GitHub account can't push to lift-demo/express-postgres.",
      }),
    );
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Commit & deploy" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Not allowed", {
        description: "Your GitHub account can't push to lift-demo/express-postgres.",
      }),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
