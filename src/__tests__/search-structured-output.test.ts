import { describe, it, expect } from "vitest";
import { z } from "zod";

const searchOutputSchema = {
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
    })
  ),
  source: z.string(),
  timing: z.number(),
};

describe("Search structured output schema", () => {
  it("validates a successful search result", () => {
    const schema = z.object(searchOutputSchema);
    const data = {
      results: [
        { title: "Result 1", url: "https://example.com/1", snippet: "First result" },
        { title: "Result 2", url: "https://example.com/2", snippet: "Second result" },
      ],
      source: "brave",
      timing: 450,
    };
    const parsed = schema.parse(data);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.source).toBe("brave");
  });

  it("rejects invalid data", () => {
    const schema = z.object(searchOutputSchema);
    expect(() => schema.parse({ results: "not an array" })).toThrow();
  });

  it("validates empty results array", () => {
    const schema = z.object(searchOutputSchema);
    const data = { results: [], source: "searxng", timing: 100 };
    const parsed = schema.parse(data);
    expect(parsed.results).toHaveLength(0);
  });
});
