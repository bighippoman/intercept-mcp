import { describe, it, expect, vi, beforeEach } from "vitest";
import { archivePhFetcher } from "../../fetchers/archive-ph.js";

describe("archivePhFetcher", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("has correct name and tier", () => {
    expect(archivePhFetcher.name).toBe("archive.ph");
    expect(archivePhFetcher.tier).toBe(2);
  });

  it("fetches from archive.ph/newest/ and extracts text", async () => {
    const html = "<html><body><div id='CONTENT'><p>Archived article content here that is long enough to pass quality checks. ".repeat(5) + "</p></div></body></html>";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(html, { status: 200 }));
    const result = await archivePhFetcher.fetch("https://example.com/article");
    expect(globalThis.fetch).toHaveBeenCalledWith("https://archive.ph/newest/https://example.com/article", expect.any(Object));
    expect(result).not.toBeNull();
    expect(result!.source).toBe("archive.ph");
  });

  it("returns null on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    expect(await archivePhFetcher.fetch("https://example.com/missing")).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    expect(await archivePhFetcher.fetch("https://example.com/down")).toBeNull();
  });
});
