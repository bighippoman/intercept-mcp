import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the module before importing the function under test
vi.mock("duck-duck-scrape", () => ({
  search: vi.fn(),
  SafeSearchType: { MODERATE: 1 },
}));

import { duckduckgoSearch } from "../../search/duckduckgo.js";

describe("duckduckgoSearch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns search results", async () => {
    const { search } = await import("duck-duck-scrape");
    vi.mocked(search).mockResolvedValueOnce({
      results: [
        { title: "Result 1", url: "https://example.com/1", description: "First result" },
        { title: "Result 2", url: "https://example.com/2", description: "Second result" },
      ],
      noResults: false,
      vqd: "",
    } as any);

    const result = await duckduckgoSearch("test query", 5);
    expect(result).not.toBeNull();
    expect(result!.results).toHaveLength(2);
    expect(result!.results[0].title).toBe("Result 1");
    expect(result!.results[0].snippet).toBe("First result");
    expect(result!.source).toBe("duckduckgo");
    expect(result!.timing).toBeGreaterThanOrEqual(0);
  });

  it("respects count parameter", async () => {
    const { search } = await import("duck-duck-scrape");
    vi.mocked(search).mockResolvedValueOnce({
      results: [
        { title: "R1", url: "https://example.com/1", description: "D1" },
        { title: "R2", url: "https://example.com/2", description: "D2" },
        { title: "R3", url: "https://example.com/3", description: "D3" },
      ],
      noResults: false,
      vqd: "",
    } as any);

    const result = await duckduckgoSearch("test", 2);
    expect(result).not.toBeNull();
    expect(result!.results).toHaveLength(2);
  });

  it("returns null on error", async () => {
    const { search } = await import("duck-duck-scrape");
    vi.mocked(search).mockRejectedValueOnce(new Error("Rate limited"));

    const result = await duckduckgoSearch("test", 5);
    expect(result).toBeNull();
  });

  it("returns null when no results", async () => {
    const { search } = await import("duck-duck-scrape");
    vi.mocked(search).mockResolvedValueOnce({
      results: [],
      noResults: true,
      vqd: "",
    } as any);

    const result = await duckduckgoSearch("xyznonexistent", 5);
    expect(result).toBeNull();
  });
});
