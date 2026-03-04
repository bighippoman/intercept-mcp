import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { SearchResponse } from "../types.js";

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveApiResponse {
  web?: { results: BraveWebResult[] };
}

export async function braveSearch(query: string, apiKey: string, count: number): Promise<SearchResponse | null> {
  const start = Date.now();
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
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
