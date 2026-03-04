import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { htmlToText } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

export const codetabsFetcher: Fetcher = {
  name: "codetabs",
  tier: 2,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;
      const response = await fetchWithTimeout(proxyUrl);
      if (!response.ok) return null;
      const html = await response.text();
      if (html.length < 200) return null;
      const content = htmlToText(html);
      return { content, source: "codetabs", quality: scoreContent(content), timing: Date.now() - start };
    } catch { return null; }
  },
};
