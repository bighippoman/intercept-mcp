import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { extractMeta } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

export const ogMetaFetcher: Fetcher = {
  name: "og-meta",
  tier: 5,
  async fetch(url: string): Promise<FetchResult> {
    const start = Date.now();
    const fallback: FetchResult = {
      content: `# ${url}\n\nCould not retrieve content. Visit the URL directly.`,
      source: "og-meta",
      quality: 0.05,
      timing: Date.now() - start,
    };
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; intercept-mcp/2.0.0)",
          Accept: "text/html",
        },
      });
      if (!response.ok) return fallback;
      const html = await response.text();
      const meta = extractMeta(html);
      const parts: string[] = [];
      const title = meta.ogTitle || meta.title;
      if (title) parts.push(`# ${title}`);
      if (meta.author) parts.push(`**Author:** ${meta.author}`);
      if (meta.publishedTime) parts.push(`**Published:** ${meta.publishedTime}`);
      const desc = meta.ogDescription || meta.description;
      if (desc) parts.push("", desc);
      if (meta.ogImage) parts.push("", `![](${meta.ogImage})`);
      if (parts.length === 0)
        parts.push(
          `# ${url}`,
          "",
          "Page metadata could not be extracted. Visit the URL directly."
        );
      const content = parts.join("\n");
      return {
        content,
        source: "og-meta",
        quality: scoreContent(content),
        timing: Date.now() - start,
      };
    } catch {
      return fallback;
    }
  },
};
