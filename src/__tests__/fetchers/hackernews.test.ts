import { describe, it, expect, vi, beforeEach } from "vitest";
import { hackerNewsFetcher } from "../../fetchers/hackernews.js";

describe("hackerNewsFetcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and tier", () => {
    expect(hackerNewsFetcher.name).toBe("hackernews");
    expect(hackerNewsFetcher.tier).toBe(4);
  });

  it("searches HN Algolia and returns results", async () => {
    const apiResponse = {
      hits: [
        {
          title: "Interesting Article",
          url: "https://example.com/article",
          points: 150,
          num_comments: 45,
          objectID: "12345",
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(apiResponse), { status: 200 })
    );
    const result = await hackerNewsFetcher.fetch("https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Interesting Article");
    expect(result!.content).toContain("150");
    expect(result!.source).toBe("hackernews");
  });

  it("returns null when no HN results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ hits: [] }), { status: 200 })
    );
    expect(
      await hackerNewsFetcher.fetch("https://example.com/obscure")
    ).toBeNull();
  });
});
