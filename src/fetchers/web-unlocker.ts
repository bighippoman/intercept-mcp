import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { htmlToMarkdown } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

/**
 * Commercial web-unlocker fetcher — the paid last resort for the hardest
 * targets (residential rotation + real-browser rendering + CAPTCHA handling),
 * via a service the user already has an account with.
 *
 * Vendor-agnostic: WEB_UNLOCKER_URL is a GET template containing a {url}
 * placeholder (and your API key), which covers the common GET-returns-HTML
 * unlockers. Examples:
 *
 *   ScrapingBee: https://app.scrapingbee.com/api/v1/?api_key=KEY&render_js=true&url={url}
 *   ScraperAPI:  https://api.scraperapi.com/?api_key=KEY&render=true&url={url}
 *   ZenRows:     https://api.zenrows.com/v1/?apikey=KEY&js_render=true&url={url}
 *
 * (Bright Data's proxy-based Web Unlocker is just an authenticated proxy — use
 * HTTPS_PROXY / INTERCEPT_PROXIES for that instead.)
 *
 * Disabled unless WEB_UNLOCKER_URL is set. Runs late and bills per request.
 */

const TIMEOUT_MS = 45_000; // unlockers render in a real browser; allow time

/** Pull HTML out of a JSON unlocker response (some vendors wrap it). */
function htmlFromJson(body: string): string | null {
  try {
    const data = JSON.parse(body) as Record<string, unknown>;
    for (const key of ["html", "body", "content", "data", "browserHtml"]) {
      const value = data[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

export const webUnlockerFetcher: Fetcher = {
  name: "web-unlocker",
  tier: 3,
  async fetch(url: string): Promise<FetchResult | null> {
    const template = process.env.WEB_UNLOCKER_URL;
    if (!template || !template.includes("{url}")) return null;

    const start = Date.now();
    const target = template.replaceAll("{url}", encodeURIComponent(url));

    try {
      const response = await fetchWithTimeout(target, { headers: { Accept: "text/html,application/json;q=0.9,*/*;q=0.8" } }, TIMEOUT_MS);
      if (!response.ok) return null;

      const contentType = response.headers.get("content-type") ?? "";
      let html = await response.text();
      if (/json/i.test(contentType)) {
        const extracted = htmlFromJson(html);
        if (!extracted) return null;
        html = extracted;
      }
      if (!html || html.length < 200) return null;

      const content = htmlToMarkdown(html);
      const quality = scoreContent(content);
      if (quality < 0.1) return null;

      return { content, source: "web-unlocker", quality, timing: Date.now() - start };
    } catch {
      return null;
    }
  },
};
