import { describe, it, expect, vi, beforeEach } from "vitest";
import { rssFetcher } from "../../fetchers/rss.js";

describe("rssFetcher", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("has correct name and tier", () => {
    expect(rssFetcher.name).toBe("rss");
    expect(rssFetcher.tier).toBe(4);
  });

  it("finds matching entry in RSS feed", async () => {
    const feedXml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><item>
        <title>Test Article</title>
        <link>https://example.com/article</link>
        <description>${"Full article content here. ".repeat(20)}</description>
      </item></channel></rss>`;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
      .mockResolvedValueOnce(new Response(feedXml, { status: 200 }));
    const result = await rssFetcher.fetch("https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("rss");
    expect(result!.content).toContain("Full article content here.");
  });

  it("returns null when no feed found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not Found", { status: 404 }));
    expect(await rssFetcher.fetch("https://example.com/no-feed")).toBeNull();
  });

  it("returns null when URL not in feed", async () => {
    const feedXml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><item>
        <title>Other Article</title>
        <link>https://example.com/other-article</link>
        <description>Other content</description>
      </item></channel></rss>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(feedXml, { status: 200 }));
    expect(await rssFetcher.fetch("https://example.com/my-article")).toBeNull();
  });
});
