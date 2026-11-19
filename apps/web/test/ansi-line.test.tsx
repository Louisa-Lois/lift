import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnsiLine } from "@/components/ansi-line";

afterEach(cleanup);

const ESC = "\u001b[";

describe("a log line with ANSI colours", () => {
  it("renders colours and bold as spans with the theme's classes", () => {
    const { container } = render(
      <div>
        <AnsiLine
          text={`${ESC}32m✓ Compiled${ESC}39m in ${ESC}1m2.1s${ESC}22m, ${ESC}31merror${ESC}0m`}
        />
      </div>,
    );
    const spans = [...container.querySelectorAll("span")];
    expect(container.textContent).toBe("✓ Compiled in 2.1s, error");
    expect(spans.find((span) => span.textContent === "✓ Compiled")?.className).toBe(
      "text-status-active",
    );
    expect(spans.find((span) => span.textContent === "2.1s")?.className).toBe("font-semibold");
    expect(spans.find((span) => span.textContent === "error")?.className).toBe(
      "text-status-failed",
    );
  });

  it("shows markup as text, never as HTML", () => {
    const { container } = render(
      <div>
        <AnsiLine text={`<script>alert(1)</script> ${ESC}33m<b>warn</b>${ESC}0m`} />
      </div>,
    );
    expect(container.querySelector("script, b")).toBeNull();
    expect(container.textContent).toBe("<script>alert(1)</script> <b>warn</b>");
  });

  it("leaves a plain line as plain text", () => {
    const { container } = render(
      <div>
        <AnsiLine text="npm ci" />
      </div>,
    );
    expect(container.innerHTML).toBe("<div>npm ci</div>");
  });
});
