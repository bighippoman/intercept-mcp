import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

/**
 * Strip navigation, footer, and menu cruft from Jina's markdown output.
 * Jina bypasses our Readability pipeline so we clean its output here.
 */
function cleanJinaMarkdown(md: string): string {
  const lines = md.split("\n");
  const cleaned: string[] = [];
  let consecutiveNavLinks = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip standalone short nav-style links: "* [Home](/)" or "[News](/news)"
    if (/^\*?\s*\[.{1,40}\]\([^)]{1,80}\)\s*$/.test(trimmed)) {
      consecutiveNavLinks++;
      // Allow isolated links but skip runs of 3+ (nav menus)
      if (consecutiveNavLinks >= 3) continue;
    } else {
      // If we were in a nav run, retroactively skip the first 1-2 links too
      if (consecutiveNavLinks >= 3) {
        // Remove the 1-2 nav links we tentatively kept
        while (cleaned.length && /^\*?\s*\[.{1,40}\]\([^)]{1,80}\)\s*$/.test(cleaned[cleaned.length - 1].trim())) {
          cleaned.pop();
        }
      }
      consecutiveNavLinks = 0;
    }

    // Skip tracking pixel images
    if (/^!\[.*?\]\(https?:\/\/.*?(bat\.bing|pixel|beacon|tracking|analytics).*?\)\s*$/.test(trimmed)) continue;

    // Skip cookie/terms banners
    if (/^(By accepting|Do Not Sell|Ad Choices$|©\d{4})/i.test(trimmed)) continue;

    cleaned.push(line);
  }

  // Collapse excessive blank lines
  return cleaned.join("\n").replace(/\n{4,}/g, "\n\n").trim();
}

export const jinaFetcher: Fetcher = {
  name: "jina",
  tier: 1,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      const response = await fetchWithTimeout(`https://r.jina.ai/${url}`, {
        headers: { Accept: "text/markdown" },
      });
      if (!response.ok) return null;
      const raw = await response.text();
      const content = cleanJinaMarkdown(raw);
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
