import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { htmlToMarkdown } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

interface ArquivoCdxEntry {
  url: string;
  timestamp: string;
  status: string;
}

export const arquivoFetcher: Fetcher = {
  name: "arquivo",
  tier: 2,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      // CDX lookup for the most recent snapshot (returns JSONL, one object per line)
      const cdxUrl = `https://arquivo.pt/wayback/cdx?url=${encodeURIComponent(url)}&limit=1&output=json&sort=reverse`;
      const cdxResp = await fetchWithTimeout(cdxUrl, {}, 8_000);
      if (!cdxResp.ok) return null;

      const text = await cdxResp.text();
      const firstLine = text.trim().split("\n")[0];
      if (!firstLine) return null;

      const entry = JSON.parse(firstLine) as ArquivoCdxEntry;
      const { url: originalUrl, timestamp } = entry;

      // Fetch raw original HTML using the id_ modifier (no wrapper/toolbar)
      const replayUrl = `https://arquivo.pt/noFrame/replay/${timestamp}id_/${originalUrl}`;
      const pageResp = await fetchWithTimeout(replayUrl, {}, 12_000);
      if (!pageResp.ok) return null;

      const html = await pageResp.text();
      if (!html || html.length < 200) return null;

      const content = htmlToMarkdown(html);
      return { content, source: "arquivo", quality: scoreContent(content), timing: Date.now() - start };
    } catch {
      return null;
    }
  },
};
