import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LoginMessage } from "@/components/login-message";

afterEach(cleanup);

describe("LoginMessage", () => {
  it("tells an uninvited visitor that Lift is invite-only, naming their account", () => {
    render(<LoginMessage error="invite_only" login="someone" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Lift is invite-only for now");
    expect(alert.textContent).toContain("@someone");
    expect(alert.textContent).toContain("Ask the Lift team to add you");
  });

  it("still explains invite-only without a login (a removed account)", () => {
    render(<LoginMessage error="invite_only" login={null} />);
    expect(screen.getByRole("alert").textContent).toContain(
      "Your GitHub account isn't on the list yet.",
    );
  });

  it.each([
    ["denied", "Sign-in cancelled"],
    ["state", "That sign-in expired"],
    ["github", "GitHub didn't answer"],
    ["config", "Sign-in isn't set up here"],
    ["something-new", "Sign-in didn't work"],
  ])("explains %s", (error, title) => {
    render(<LoginMessage error={error} login={null} />);
    expect(screen.getByRole("alert").textContent).toContain(title);
  });
});
