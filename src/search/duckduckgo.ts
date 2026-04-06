import type { SearchResponse } from "../types.js";

export async function duckduckgoSearch(
  query: string,
  count: number,
): Promise<SearchResponse | null> {
  const start = Date.now();
  try {
    const { search, SafeSearchType } = await import("duck-duck-scrape");
    const results = await search(query, { safeSearch: SafeSearchType.MODERATE });

    if (!results.results || results.results.length === 0) return null;

    return {
      results: results.results.slice(0, count).map((r: { title: string; url: string; description: string }) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      })),
      source: "duckduckgo",
      timing: Date.now() - start,
    };
  } catch {
    return null;
  }
}
