import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { htmlToMarkdown } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

interface WaybackResponse {
  archived_snapshots: {
    closest?: { available: boolean; url: string; status: string; };
  };
}

export const waybackFetcher: Fetcher = {
  name: "wayback",
  tier: 2,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
      const apiResponse = await fetchWithTimeout(apiUrl);
      if (!apiResponse.ok) return null;
      const data = (await apiResponse.json()) as WaybackResponse;
      const snapshot = data.archived_snapshots?.closest;
      if (!snapshot?.available || !snapshot.url) return null;
      // Use id_ modifier to get raw original HTML without Wayback toolbar
      const rawUrl = snapshot.url.replace(/\/web\/(\d+)\//, "/web/$1id_/");
      const pageResponse = await fetchWithTimeout(rawUrl);
      if (!pageResponse.ok) return null;
      const html = await pageResponse.text();
      const content = htmlToMarkdown(html);
      return { content, source: "wayback", quality: scoreContent(content), timing: Date.now() - start };
    } catch { return null; }
  },
};
