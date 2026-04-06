import { describe, it, expect } from "vitest";

describe("Error response format", () => {
  it("fetch failure response includes isError: true", () => {
    const response = {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "Failed to fetch content from https://dead.com. This URL failed earlier in this session and was not re-attempted.",
        },
      ],
    };
    expect(response.isError).toBe(true);
    expect(response.content[0].type).toBe("text");
  });

  it("search failure response includes isError: true and instructional message", () => {
    const response = {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "Search failed. To enable search, set the BRAVE_API_KEY environment variable or configure SEARXNG_URL to point to a SearXNG instance.",
        },
      ],
    };
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("BRAVE_API_KEY");
    expect(response.content[0].text).toContain("SEARXNG_URL");
  });

  it("pipeline total-failure response includes isError: true", () => {
    const response = {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "Failed to fetch content from https://example.com. All strategies failed.",
        },
      ],
    };
    expect(response.isError).toBe(true);
  });
});
