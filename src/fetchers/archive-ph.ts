import { htmlToText } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

export const archivePhFetcher: Fetcher = {
  name: "archive.ph",
  tier: 2,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      const response = await fetch(`https://archive.ph/newest/${url}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
        redirect: "follow",
      });
      if (!response.ok) return null;
      const html = await response.text();
      const content = htmlToText(html);
      return { content, source: "archive.ph", quality: scoreContent(content), timing: Date.now() - start };
    } catch { return null; }
  },
};
