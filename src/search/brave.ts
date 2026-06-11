import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { SearchResponse, SearchOptions } from "../types.js";

const FRESHNESS_MAP: Record<string, string> = { day: "pd", week: "pw", month: "pm", year: "py" };

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveApiResponse {
  web?: { results: BraveWebResult[] };
}

export async function braveSearch(
  query: string,
  apiKey: string,
  count: number,
  options: SearchOptions = {},
): Promise<SearchResponse | null> {
  const start = Date.now();
  try {
    let url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    if (options.freshness) url += `&freshness=${FRESHNESS_MAP[options.freshness]}`;
    // Brave's offset is a page index (0-based)
    if (options.page && options.page > 1) url += `&offset=${Math.min(options.page - 1, 9)}`;
    const response = await fetchWithTimeout(url, {
      headers: {
        "Accept": "application/json",
        "X-Subscription-Token": apiKey,
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as BraveApiResponse;
    const webResults = data.web?.results ?? [];

    return {
      results: webResults.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      })),
      source: "brave",
      timing: Date.now() - start,
    };
  } catch {
    return null;
  }
}
