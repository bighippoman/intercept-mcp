import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { htmlToText, htmlToMarkdown } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

const FEED_PATHS = ["/feed", "/rss", "/atom.xml", "/feed.xml", "/rss.xml", "?feed=rss2"];

function extractItemsFromFeed(xml: string): Array<{ link: string; content: string; title: string }> {
  const items: Array<{ link: string; content: string; title: string }> = [];
  const itemRegex = /<(?:item|entry)[\s>]([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const linkMatch = block.match(/<link[^>]*>([^<]*)<\/link>/i) || block.match(/<link[^>]*href="([^"]*)"[^>]*\/?>/i);
    const link = linkMatch ? linkMatch[1].trim() : "";
    const contentMatch = block.match(/<(?:content:encoded|content|description)[\s>]*>([\s\S]*?)<\/(?:content:encoded|content|description)>/i);
    const rawContent = contentMatch ? contentMatch[1] : "";
    const titleMatch = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1").trim() : "";
    const content = rawContent.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    items.push({ link, content: htmlToMarkdown(content), title });
  }
  return items;
}

export const rssFetcher: Fetcher = {
  name: "rss",
  tier: 4,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      const parsedUrl = new URL(url);
      const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
      for (const path of FEED_PATHS) {
        const feedUrl = path.startsWith("?") ? `${baseUrl}/${path}` : `${baseUrl}${path}`;
        try {
          const response = await fetchWithTimeout(feedUrl, { headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
          if (!response.ok) continue;
          const xml = await response.text();
          const items = extractItemsFromFeed(xml);
          const match = items.find((item) => item.link === url || url.includes(item.link) || (parsedUrl.pathname.length > 1 && item.link.includes(parsedUrl.pathname)));
          if (match && match.content) {
            const content = match.title ? `# ${match.title}\n\n${match.content}` : match.content;
            return { content, source: "rss", quality: scoreContent(content), timing: Date.now() - start };
          }
        } catch { continue; }
      }
      return null;
    } catch { return null; }
  },
};
