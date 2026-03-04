import { describe, it, expect, vi, beforeEach } from "vitest";
import { braveSearch } from "../../search/brave.js";

describe("braveSearch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct request to Brave API", async () => {
    const mockResponse = {
      web: {
        results: [
          { title: "Result 1", url: "https://example.com/1", description: "First result" },
          { title: "Result 2", url: "https://example.com/2", description: "Second result" },
        ],
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await braveSearch("test query", "test-api-key", 5);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("api.search.brave.com"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Subscription-Token": "test-api-key",
        }),
      })
    );
    expect(result).not.toBeNull();
    expect(result!.results).toHaveLength(2);
    expect(result!.results[0].title).toBe("Result 1");
    expect(result!.source).toBe("brave");
  });

  it("returns null on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );
    const result = await braveSearch("test", "bad-key", 5);
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await braveSearch("test", "key", 5);
    expect(result).toBeNull();
  });
});
