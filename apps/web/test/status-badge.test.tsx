import { DEPLOYMENT_STATUSES } from "@lift/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { STATUS_STYLES, StatusBadge } from "@/components/status-badge";

afterEach(cleanup);

describe("StatusBadge", () => {
  it.each(DEPLOYMENT_STATUSES)("shows %s by name, not by colour alone", (status) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(STATUS_STYLES[status].label);
    expect(badge.getAttribute("data-status")).toBe(status);
    const dot = badge.querySelector("[data-slot=status-dot]");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses the canceled colour for superseded deployments", () => {
    render(<StatusBadge status="superseded" />);
    const dot = screen.getByText("Superseded").querySelector("[data-slot=status-dot]");
    expect(dot?.className).toContain("bg-status-canceled");
  });

  it("pulses only while building or deploying", () => {
    for (const status of DEPLOYMENT_STATUSES) {
      const { container, unmount } = render(<StatusBadge status={status} />);
      const pulsing = container.querySelector(".animate-pulse") !== null;
      expect(pulsing, status).toBe(status === "building" || status === "deploying");
      unmount();
    }
  });
});
