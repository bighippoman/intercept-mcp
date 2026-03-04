import { describe, it, expect, vi, beforeEach } from "vitest";
import { searxngSearch } from "../../search/searxng.js";

describe("searxngSearch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct request to SearXNG instance", async () => {
    const mockResponse = {
      results: [
        { title: "Result 1", url: "https://example.com/1", content: "First result snippet" },
        { title: "Result 2", url: "https://example.com/2", content: "Second result snippet" },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await searxngSearch("test query", "https://searx.example.com", 5);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("searx.example.com/search"),
      expect.anything()
    );
    expect(result).not.toBeNull();
    expect(result!.results).toHaveLength(2);
    expect(result!.results[0].title).toBe("Result 1");
    expect(result!.results[0].snippet).toBe("First result snippet");
    expect(result!.source).toBe("searxng");
  });

  it("returns null on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Error", { status: 500 })
    );
    const result = await searxngSearch("test", "https://searx.example.com", 5);
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await searxngSearch("test", "https://searx.example.com", 5);
    expect(result).toBeNull();
  });
});
