import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

export const jinaFetcher: Fetcher = {
  name: "jina",
  tier: 1,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      const response = await fetch(`https://r.jina.ai/${url}`, {
        headers: { Accept: "text/markdown" },
      });
      if (!response.ok) return null;
      const content = await response.text();
      return {
        content,
        source: "jina",
        quality: scoreContent(content),
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
