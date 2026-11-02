import { fetchWithTimeout, getProxyUrl } from "../fetch-with-timeout.js";
import { htmlToMarkdown } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";
import { requestSignal } from "../request-context.js";
import { blockedUrlReason } from "../url-guard.js";
import { setTimeout as delay } from "node:timers/promises";

const TIMEMAP_TIMEOUT = 4_000;
const SNAPSHOT_DELAY = 1_000;
const SNAPSHOT_TIMEOUT = 8_000;

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

async function findSnapshotUrl(candidate: string): Promise<string | null> {
  try {
    const timemapUrl = `https://archive.ph/timemap/${candidate}`;
    const resp = await fetchWithTimeout(timemapUrl, {}, TIMEMAP_TIMEOUT);
    if (!resp.ok) return null;
    const body = await resp.text();
    if (body.includes("TimeMap does not exists")) return null;
    return parseLatestMementoUrl(body);
  } catch {
    return null;
  }
}

export const archivePhFetcher: Fetcher = {
  name: "archive-ph",
  tier: 4,
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

      const snapshotUrl = (await Promise.all(urls.map(findSnapshotUrl))).find((u): u is string => Boolean(u)) ?? null;

      if (!snapshotUrl || blockedUrlReason(snapshotUrl)) return null;

      // Delay to avoid archive.ph rate limiting (triggers captcha)
      await delay(SNAPSHOT_DELAY, undefined, { signal: requestSignal() });

      // Use got-scraping to bypass archive.ph's Cloudflare captcha
      // (stealth TLS fingerprint impersonation works against their challenge)
      const { gotScraping } = await import("got-scraping");
      const proxyUrl = getProxyUrl();

      const response = await gotScraping({
        url: snapshotUrl,
        signal: requestSignal(),
        hooks: { beforeRedirect: [(options) => { if (!options.url) throw new Error("Missing redirect URL"); const reason = blockedUrlReason(options.url.toString()); if (reason) throw new Error(reason); }] },
        headerGeneratorOptions: {
          browsers: ["chrome"],
          operatingSystems: ["macos", "windows"],
        },
        timeout: { request: SNAPSHOT_TIMEOUT },
        followRedirect: true,
        maxRedirects: 5,
        ...(proxyUrl ? { proxyUrl } : {}),
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
