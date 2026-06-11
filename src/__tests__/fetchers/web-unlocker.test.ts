import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webUnlockerFetcher } from "../../fetchers/web-unlocker.js";

const ARTICLE = `<html><body><article><h1>Unlocked</h1><p>${"Content recovered through the commercial unlocker service. ".repeat(8)}</p></article></body></html>`;

describe("webUnlockerFetcher", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("has the expected name and tier", () => {
    expect(webUnlockerFetcher.name).toBe("web-unlocker");
    expect(webUnlockerFetcher.tier).toBe(3);
  });

  it("returns null when WEB_UNLOCKER_URL is unset", async () => {
    delete process.env.WEB_UNLOCKER_URL;
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await webUnlockerFetcher.fetch("https://hard.example.com/x")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null when the template lacks a {url} placeholder", async () => {
    process.env.WEB_UNLOCKER_URL = "https://api.vendor.com/?key=abc";
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await webUnlockerFetcher.fetch("https://hard.example.com/x")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("substitutes the encoded target URL into the template and returns markdown", async () => {
    process.env.WEB_UNLOCKER_URL = "https://app.scrapingbee.com/api/v1/?api_key=KEY&render_js=true&url={url}";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(ARTICLE, { status: 200 }));

    const result = await webUnlockerFetcher.fetch("https://hard.example.com/page?a=1&b=2");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("web-unlocker");
    expect(result!.content).toContain("Unlocked");

    const called = String(spy.mock.calls[0][0]);
    expect(called).toContain(encodeURIComponent("https://hard.example.com/page?a=1&b=2"));
    expect(called).not.toContain("{url}");
  });

  it("extracts HTML from a JSON unlocker response", async () => {
    process.env.WEB_UNLOCKER_URL = "https://api.vendor.com/?key=abc&url={url}";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ html: ARTICLE }), { status: 200, headers: { "content-type": "application/json" } })
    );

    const result = await webUnlockerFetcher.fetch("https://hard.example.com/x");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Unlocked");
  });

  it("returns null on a non-ok response", async () => {
    process.env.WEB_UNLOCKER_URL = "https://api.vendor.com/?url={url}";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("quota exceeded", { status: 402 }));
    expect(await webUnlockerFetcher.fetch("https://hard.example.com/x")).toBeNull();
  });

  it("returns null on network error", async () => {
    process.env.WEB_UNLOCKER_URL = "https://api.vendor.com/?url={url}";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"));
    expect(await webUnlockerFetcher.fetch("https://hard.example.com/x")).toBeNull();
  });
});
