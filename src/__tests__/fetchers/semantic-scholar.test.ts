import { describe, it, expect, vi, beforeEach } from "vitest";
import { semanticScholarFetcher } from "../../fetchers/semantic-scholar.js";

describe("semanticScholarFetcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and tier", () => {
    expect(semanticScholarFetcher.name).toBe("semantic-scholar");
    expect(semanticScholarFetcher.tier).toBe(4);
  });

  it("fetches paper details by URL", async () => {
    const apiResponse = {
      title: "Deep Learning for NLP",
      abstract:
        "This paper presents a comprehensive survey of deep learning methods for natural language processing. ".repeat(
          3,
        ),
      tldr: { text: "Survey of DL methods for NLP" },
      authors: [{ name: "John Smith" }],
      year: 2024,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(apiResponse), { status: 200 }),
    );
    const result = await semanticScholarFetcher.fetch(
      "https://arxiv.org/abs/2401.12345",
    );
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Deep Learning for NLP");
    expect(result!.content).toContain("John Smith");
    expect(result!.source).toBe("semantic-scholar");
  });

  it("returns null on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );
    expect(
      await semanticScholarFetcher.fetch("https://example.com/not-a-paper"),
    ).toBeNull();
  });
});
