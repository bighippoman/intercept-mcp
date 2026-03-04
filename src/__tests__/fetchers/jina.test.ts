import { describe, it, expect, vi, beforeEach } from "vitest";
import { jinaFetcher } from "../../fetchers/jina.js";

describe("jinaFetcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and tier", () => {
    expect(jinaFetcher.name).toBe("jina");
    expect(jinaFetcher.tier).toBe(1);
  });

  it("fetches via r.jina.ai and returns content", async () => {
    const mockContent = "# Article Title\n\nArticle body content here.";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(mockContent, { status: 200 })
    );

    const result = await jinaFetcher.fetch("https://example.com/article");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://r.jina.ai/https://example.com/article",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "text/markdown" }) })
    );
    expect(result).not.toBeNull();
    expect(result!.content).toBe(mockContent);
    expect(result!.source).toBe("jina");
  });

  it("returns null on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 })
    );
    const result = await jinaFetcher.fetch("https://example.com/blocked");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await jinaFetcher.fetch("https://example.com/down");
    expect(result).toBeNull();
  });

  it("includes timing information", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Content", { status: 200 })
    );
    const result = await jinaFetcher.fetch("https://example.com");
    expect(result).not.toBeNull();
    expect(result!.timing).toBeGreaterThanOrEqual(0);
  });
});
