/**
 * Stealth fetcher using got-scraping for browser TLS fingerprint impersonation.
 *
 * WARNING: This fetcher impersonates real browser fingerprints to avoid bot
 * detection. Use at your own risk and responsibility. Some websites may
 * consider this a violation of their terms of service.
 *
 * Only active when USE_STEALTH_FETCH=true is set.
 */
import { htmlToMarkdown } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

export const stealthFetcher: Fetcher = {
  name: "stealth",
  tier: 3,
  async fetch(url: string): Promise<FetchResult | null> {
    if (process.env.USE_STEALTH_FETCH !== "true") return null;

    const start = Date.now();
    try {
      const { gotScraping } = await import("got-scraping");

      const response = await gotScraping({
        url,
        headerGeneratorOptions: {
          browsers: ["chrome"],
          operatingSystems: ["macos", "windows"],
        },
        timeout: { request: 12_000 },
        followRedirect: true,
        maxRedirects: 5,
      });

      if (response.statusCode < 200 || response.statusCode >= 400) return null;

      const html = response.body;
      if (!html || html.length < 200) return null;

      const content = htmlToMarkdown(html);
      return {
        content,
        source: "stealth",
        quality: scoreContent(content),
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
