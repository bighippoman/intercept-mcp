import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { htmlToMarkdown } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

export const googleCacheFetcher: Fetcher = {
  name: "google-cache",
  tier: 2,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      // strip=1 requests text-only version (avoids JS/styling issues)
      const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}&strip=1`;
      const response = await fetchWithTimeout(cacheUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
      }, 10_000);

      if (!response.ok) return null;
      const html = await response.text();

      // Detect Google captcha / JS challenge
      const lower = html.toLowerCase();
      if (lower.includes("unusual traffic") || lower.includes("captcha") || lower.includes("are you a robot")) return null;

      // Google cache text-only mode wraps content in <pre> or serves plain HTML
      const content = htmlToMarkdown(html);
      const quality = scoreContent(content);
      if (quality < 0.1) return null;

      return { content, source: "google-cache", quality, timing: Date.now() - start };
    } catch {
      return null;
    }
  },
};
