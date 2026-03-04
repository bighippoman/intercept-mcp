import { describe, it, expect, vi, beforeEach } from "vitest";
import { crossrefFetcher } from "../../fetchers/crossref.js";

describe("crossrefFetcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and tier", () => {
    expect(crossrefFetcher.name).toBe("crossref");
    expect(crossrefFetcher.tier).toBe(4);
  });

  it("extracts DOI from URL and fetches metadata", async () => {
    const apiResponse = {
      message: {
        title: ["Understanding Neural Networks"],
        abstract:
          "This paper explores the fundamentals of neural network architectures and their applications in modern machine learning. ".repeat(
            3,
          ),
        author: [{ given: "Jane", family: "Doe" }],
        published: { "date-parts": [[2024, 6]] },
        "container-title": ["Journal of ML"],
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(apiResponse), { status: 200 }),
    );
    const result = await crossrefFetcher.fetch(
      "https://doi.org/10.1234/test.5678",
    );
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Understanding Neural Networks");
    expect(result!.content).toContain("Jane Doe");
    expect(result!.source).toBe("crossref");
  });

  it("returns null for non-DOI URLs", async () => {
    const result = await crossrefFetcher.fetch(
      "https://example.com/regular-page",
    );
    expect(result).toBeNull();
  });

  it("returns null on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );
    expect(
      await crossrefFetcher.fetch("https://doi.org/10.1234/notfound"),
    ).toBeNull();
  });
});
