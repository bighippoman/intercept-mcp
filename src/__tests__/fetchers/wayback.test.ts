import { describe, it, expect, vi, beforeEach } from "vitest";
import { waybackFetcher } from "../../fetchers/wayback.js";

describe("waybackFetcher", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("has correct name and tier", () => {
    expect(waybackFetcher.name).toBe("wayback");
    expect(waybackFetcher.tier).toBe(2);
  });

  it("queries availability API then fetches snapshot", async () => {
    const availabilityResponse = { archived_snapshots: { closest: { available: true, url: "https://web.archive.org/web/20250101/https://example.com/article", status: "200" } } };
    const snapshotHtml = "<html><body><p>" + "Archived article content. ".repeat(20) + "</p></body></html>";
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(availabilityResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(snapshotHtml, { status: 200 }));
    const result = await waybackFetcher.fetch("https://example.com/article");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("wayback");
  });

  it("returns null when no snapshot available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ archived_snapshots: {} }), { status: 200 }));
    expect(await waybackFetcher.fetch("https://example.com/new-page")).toBeNull();
  });

  it("returns null on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("timeout"));
    expect(await waybackFetcher.fetch("https://example.com/down")).toBeNull();
  });
});
