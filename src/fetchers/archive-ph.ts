import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { htmlToMarkdown } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

/**
 * Parse a Memento timemap response to extract the most recent snapshot URL.
 * Format: `<URL>; rel="memento"; datetime="..."` per line.
 */
function parseLatestMementoUrl(timemap: string): string | null {
  const lines = timemap.split(",\n").map((l) => l.trim());
  let latest: string | null = null;

  for (const line of lines) {
    if (!line.includes('rel="memento"') && !line.includes('rel="last memento"') && !line.includes('rel="first memento"')) continue;
    const match = line.match(/^<([^>]+)>/);
    if (match) latest = match[1]; // last one wins = most recent
  }

  return latest;
}

export const archivePhFetcher: Fetcher = {
  name: "archive-ph",
  tier: 2,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      // Try both with and without www
      const urls = [url];
      const parsed = new URL(url);
      if (parsed.hostname.startsWith("www.")) {
        urls.push(url.replace("www.", ""));
      } else {
        urls.push(url.replace(`://${parsed.hostname}`, `://www.${parsed.hostname}`));
      }

      let snapshotUrl: string | null = null;

      for (const candidate of urls) {
        const timemapUrl = `https://archive.ph/timemap/${candidate}`;
        const resp = await fetchWithTimeout(timemapUrl, {}, 8_000);
        if (!resp.ok) continue;
        const body = await resp.text();
        if (body.includes("TimeMap does not exists")) continue;
        snapshotUrl = parseLatestMementoUrl(body);
        if (snapshotUrl) break;
      }

      if (!snapshotUrl) return null;

      // Use got-scraping to bypass archive.ph's Cloudflare captcha
      // (stealth TLS fingerprint impersonation works against their challenge)
      const { gotScraping } = await import("got-scraping");

      const response = await gotScraping({
        url: snapshotUrl,
        headerGeneratorOptions: {
          browsers: ["chrome"],
          operatingSystems: ["macos", "windows"],
        },
        timeout: { request: 15_000 },
        followRedirect: true,
        maxRedirects: 5,
      });

      if (response.statusCode < 200 || response.statusCode >= 400) return null;

      const html = response.body;
      if (!html || html.length < 500) return null;
      if (html.toLowerCase().includes("captcha")) return null;

      const content = htmlToMarkdown(html);
      return { content, source: "archive-ph", quality: scoreContent(content), timing: Date.now() - start };
    } catch {
      return null;
    }
  },
};
