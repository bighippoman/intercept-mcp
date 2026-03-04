import { htmlToText } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
];

let uaIndex = 0;

export const rawFetcher: Fetcher = {
  name: "raw",
  tier: 3,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    const ua = USER_AGENTS[uaIndex % USER_AGENTS.length];
    uaIndex++;
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": ua,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
        redirect: "follow",
      });
      if (!response.ok) return null;
      const html = await response.text();
      const content = htmlToText(html);
      return { content, source: "raw", quality: scoreContent(content), timing: Date.now() - start };
    } catch { return null; }
  },
};
