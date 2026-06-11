import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { SearchResponse, SearchOptions } from "../types.js";

interface SearXNGResult {
  title: string;
  url: string;
  content: string;
}

interface SearXNGApiResponse {
  results: SearXNGResult[];
}

export async function searxngSearch(
  query: string,
  instanceUrl: string,
  count: number,
  options: SearchOptions = {},
): Promise<SearchResponse | null> {
  const start = Date.now();
  try {
    const baseUrl = instanceUrl.replace(/\/$/, "");
    let url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&pageno=${options.page ?? 1}`;
    if (options.freshness) url += `&time_range=${options.freshness}`;
    const response = await fetchWithTimeout(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as SearXNGApiResponse;

    const results = data.results ?? [];
    return {
      results: results.slice(0, count).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
      })),
      source: "searxng",
      timing: Date.now() - start,
    };
  } catch {
    return null;
  }
}
