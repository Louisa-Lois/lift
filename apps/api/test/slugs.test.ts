import { Slug, Subdomain } from "@lift/shared";
import { describe, expect, it } from "vitest";
import { slugify, subdomainFor, subdomainWithSuffix, withSuffix } from "../src/services/slugs";

describe("slugs", () => {
  it("turns a name into a slug", () => {
    expect(slugify("Demo shop")).toBe("demo-shop");
    expect(slugify("  Café Résumé!! 2 ")).toBe("cafe-resume-2");
    expect(slugify("web")).toBe("web");
  });

  it("pads a name too short or without letters with a random suffix", () => {
    expect(slugify("A")).toMatch(/^a-[a-z0-9]{4}$/);
    expect(slugify("!!!")).toMatch(/^app-[a-z0-9]{4}$/);
  });

  it("cuts long names to 32 characters without a trailing hyphen", () => {
    const slug = slugify("a very long project name that keeps on going and going");
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(Slug.safeParse(slug).success).toBe(true);
  });

  it("adds a 4-character suffix on a clash and stays valid", () => {
    const slug = withSuffix("x".repeat(32));
    expect(slug).toMatch(/^x{27}-[a-z0-9]{4}$/);
    expect(Slug.safeParse(slug).success).toBe(true);
  });

  it("builds {service}-{project} subdomains that are one DNS label", () => {
    expect(subdomainFor("web", "demo-shop")).toBe("web-demo-shop");
    const long = subdomainFor("s".repeat(32), "p".repeat(32));
    expect(long.length).toBeLessThanOrEqual(63);
    expect(Subdomain.safeParse(long).success).toBe(true);
    expect(Subdomain.safeParse(subdomainWithSuffix(long)).success).toBe(true);
  });
});
