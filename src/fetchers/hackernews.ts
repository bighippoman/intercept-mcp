import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

interface HNResponse {
  hits: Array<{
    title: string;
    url?: string;
    points: number;
    num_comments: number;
    objectID: string;
  }>;
}

export const hackerNewsFetcher: Fetcher = {
  name: "hackernews",
  tier: 4,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      const apiUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(url)}&tags=story&hitsPerPage=5`;
      const response = await fetch(apiUrl);
      if (!response.ok) return null;
      const data = (await response.json()) as HNResponse;
      if (!data.hits.length) return null;
      const parts: string[] = ["# HackerNews Discussions", ""];
      for (const hit of data.hits) {
        parts.push(`## ${hit.title}`);
        parts.push(`- Points: ${hit.points} | Comments: ${hit.num_comments}`);
        parts.push(`- HN: https://news.ycombinator.com/item?id=${hit.objectID}`);
        if (hit.url) parts.push(`- URL: ${hit.url}`);
        parts.push("");
      }
      const content = parts.join("\n");
      return {
        content,
        source: "hackernews",
        quality: scoreContent(content),
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
