import { describe, it, expect, vi, beforeEach } from "vitest";
import { ogMetaFetcher } from "../../fetchers/og-meta.js";

describe("ogMetaFetcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and tier", () => {
    expect(ogMetaFetcher.name).toBe("og-meta");
    expect(ogMetaFetcher.tier).toBe(5);
  });

  it("extracts OG meta tags from page", async () => {
    const html = `<html><head><title>Page Title</title><meta property="og:title" content="OG Title" /><meta property="og:description" content="A great description of the page" /><meta property="article:author" content="Jane Doe" /><meta property="article:published_time" content="2025-01-15" /></head><body></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );
    const result = await ogMetaFetcher.fetch("https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("OG Title");
    expect(result!.content).toContain("A great description of the page");
    expect(result!.content).toContain("Jane Doe");
    expect(result!.source).toBe("og-meta");
  });

  it("falls back to title tag when no OG tags", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        `<html><head><title>Just a Title</title></head><body></body></html>`,
        { status: 200 }
      )
    );
    const result = await ogMetaFetcher.fetch("https://example.com/minimal");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Just a Title");
  });

  it("never returns null — always produces some content", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error")
    );
    const result = await ogMetaFetcher.fetch("https://example.com/down");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("example.com");
    expect(result!.source).toBe("og-meta");
  });

  it("returns the URL itself as minimum content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<html><body>Nothing useful</body></html>", { status: 200 })
    );
    const result = await ogMetaFetcher.fetch("https://example.com/empty");
    expect(result).not.toBeNull();
    expect(result!.content.length).toBeGreaterThan(0);
  });
});
