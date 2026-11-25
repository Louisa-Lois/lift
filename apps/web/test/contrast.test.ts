// @vitest-environment node
import { describe, expect, it } from "vitest";
import { contrastRatio, parseRgb, toHex } from "../src/components/marketing/contrast";

describe("contrast", () => {
  it("reads the rgb() strings browsers return for computed colours", () => {
    expect(parseRgb("rgb(122, 63, 209)")).toEqual([122, 63, 209]);
    expect(parseRgb("rgba(10, 10, 22, 1)")).toEqual([10, 10, 22]);
    expect(parseRgb("color(srgb 1 0.5 0)")).toEqual([255, 128, 0]);
    expect(parseRgb("not a colour")).toBeNull();
  });

  it("formats a colour as lowercase hex", () => {
    expect(toHex([122, 63, 209])).toBe("#7a3fd1");
  });

  it("matches the WCAG 2 contrast formula", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
    // White on Nebula Purple, the primary button.
    expect(contrastRatio([255, 255, 255], [122, 63, 209])).toBeCloseTo(6.07, 1);
  });
});
