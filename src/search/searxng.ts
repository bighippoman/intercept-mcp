import { fetchWithTimeout } from "../fetch-with-timeout.js";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  source: string;
  timing: number;
}

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
): Promise<SearchResponse | null> {
  const start = Date.now();
  try {
    const baseUrl = instanceUrl.replace(/\/$/, "");
    const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&pageno=1`;
    const response = await fetchWithTimeout(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as SearXNGApiResponse;

    return {
      results: data.results.slice(0, count).map((r) => ({
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
