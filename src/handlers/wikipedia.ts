import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { htmlToMarkdown } from "../html.js";
import type { Handler, HandlerResult } from "../types.js";

function extractWikiTitle(url: string): { lang: string; title: string } | null {
  const match = url.match(/([a-z]{2,3})\.wikipedia\.org\/wiki\/(.+)/);
  if (!match) return null;
  return { lang: match[1], title: decodeURIComponent(match[2]).replace(/#.*$/, "") };
}

export const wikipediaHandler: Handler = {
  name: "wikipedia",
  patterns: [/[a-z]{2,3}\.wikipedia\.org\/wiki\/.+/],
  async handle(url: string): Promise<HandlerResult | null> {
    const start = Date.now();
    const parsed = extractWikiTitle(url);
    if (!parsed) return null;

    const { lang, title } = parsed;

    try {
      const htmlUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
      const response = await fetchWithTimeout(htmlUrl, {
        headers: {
          "User-Agent": "intercept-mcp/3.0.0 (https://github.com/bighippoman/intercept-mcp)",
          Accept: "text/html",
        },
      });

      if (response.ok) {
        const html = await response.text();
        const markdown = htmlToMarkdown(html);
        if (markdown.length >= 200) {
          return {
            content: markdown,
            source: "wikipedia",
            timing: Date.now() - start,
          };
        }
      }

      // Fallback: summary endpoint
      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const summaryResponse = await fetchWithTimeout(summaryUrl, {
        headers: {
          "User-Agent": "intercept-mcp/3.0.0 (https://github.com/bighippoman/intercept-mcp)",
          Accept: "application/json",
        },
      });

      if (!summaryResponse.ok) return null;

      const data = (await summaryResponse.json()) as {
        title?: string;
        extract?: string;
        description?: string;
      };

      if (!data.extract) return null;

      const parts: string[] = [];
      if (data.title) parts.push(`# ${data.title}`);
      if (data.description) parts.push(`*${data.description}*`);
      parts.push("", data.extract);

      return {
        content: parts.join("\n"),
        source: "wikipedia",
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
