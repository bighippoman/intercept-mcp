import { describe, it, expect, vi, beforeEach } from "vitest";
import { rawFetcher } from "../../fetchers/raw.js";

describe("rawFetcher", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("has correct name and tier", () => {
    expect(rawFetcher.name).toBe("raw");
    expect(rawFetcher.tier).toBe(3);
  });

  it("fetches with browser-like headers", async () => {
    const html = "<html><body><p>" + "Real article content. ".repeat(20) + "</p></body></html>";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(html, { status: 200 }));
    const result = await rawFetcher.fetch("https://example.com/article");
    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBeDefined();
    expect(headers["Accept-Language"]).toBeDefined();
    expect(headers["Sec-Fetch-Dest"]).toBe("document");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("raw");
  });

  it("extracts text from HTML response", async () => {
    const html = "<html><body><p>" + "This is article text. ".repeat(20) + "</p></body></html>";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(html, { status: 200 }));
    const result = await rawFetcher.fetch("https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("This is article text.");
    expect(result!.content).not.toContain("<p>");
  });

  it("returns null on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    expect(await rawFetcher.fetch("https://example.com/blocked")).toBeNull();
  });
});
