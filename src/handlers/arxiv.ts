import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { Handler, HandlerResult } from "../types.js";

function extractArxivId(url: string): string | null {
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]+\.[0-9]+)/);
  return match ? match[1] : null;
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function extractAllTags(xml: string, tag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function extractCategories(xml: string): string[] {
  const results: string[] = [];
  const regex = /<category\s+term="([^"]+)"/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

export const arxivHandler: Handler = {
  name: "arxiv",
  patterns: [
    /arxiv\.org\/abs\/[0-9]+\.[0-9]+/,
    /arxiv\.org\/pdf\/[0-9]+\.[0-9]+/,
  ],
  async handle(url: string): Promise<HandlerResult | null> {
    const start = Date.now();
    const id = extractArxivId(url);
    if (!id) return null;

    try {
      const apiUrl = `https://export.arxiv.org/api/query?id_list=${id}`;
      const response = await fetchWithTimeout(apiUrl);
      if (!response.ok) return null;
      const xml = await response.text();

      const entry = extractTag(xml, "entry");
      if (!entry) return null;

      const title = extractTag(entry, "title").replace(/\s+/g, " ");
      const summary = extractTag(entry, "summary").replace(/\s+/g, " ");
      const authors = extractAllTags(entry, "name");
      const published = extractTag(entry, "published");
      const updated = extractTag(entry, "updated");
      const categories = extractCategories(entry);

      if (!title) return null;

      const parts: string[] = [];
      parts.push(`# ${title}`);
      if (authors.length) parts.push(`**Authors:** ${authors.join(", ")}`);
      if (published) parts.push(`**Published:** ${published.slice(0, 10)}`);
      if (updated && updated !== published) parts.push(`**Updated:** ${updated.slice(0, 10)}`);
      if (categories.length) parts.push(`**Categories:** ${categories.join(", ")}`);
      parts.push(`**arXiv:** ${id}`);
      parts.push(`**PDF:** https://arxiv.org/pdf/${id}`);
      parts.push("");
      parts.push("## Abstract");
      parts.push(summary);

      return {
        content: parts.join("\n"),
        source: "arxiv",
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
