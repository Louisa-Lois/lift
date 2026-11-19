import { describe, expect, it } from "vitest";
import { appHostname, appsRouting, appUrl } from "../src/index";

describe("appsRouting", () => {
  it("serves *.localhost over plain HTTP on the web entry point", () => {
    expect(appsRouting("apps.localhost")).toEqual({
      scheme: "http",
      entryPoint: "web",
      tls: false,
    });
    expect(appsRouting("localhost").scheme).toBe("http");
  });

  it("serves every other domain over HTTPS with TLS", () => {
    expect(appsRouting("apps.trylift.dev")).toEqual({
      scheme: "https",
      entryPoint: "websecure",
      tls: true,
    });
    // A domain that merely contains "localhost" is not local.
    expect(appsRouting("apps.notlocalhost.dev").scheme).toBe("https");
  });
});

describe("app URLs", () => {
  it("builds the generated hostname and its URL", () => {
    const hostname = appHostname("web-demo-shop", "apps.trylift.dev");
    expect(hostname).toBe("web-demo-shop.apps.trylift.dev");
    expect(appUrl(hostname, "apps.trylift.dev")).toBe("https://web-demo-shop.apps.trylift.dev");
    expect(appUrl("web-demo-shop.apps.localhost", "apps.localhost")).toBe(
      "http://web-demo-shop.apps.localhost",
    );
  });
});
