import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

interface SemanticScholarResponse {
  title?: string;
  abstract?: string;
  tldr?: { text: string };
  authors?: Array<{ name: string }>;
  year?: number;
}

export const semanticScholarFetcher: Fetcher = {
  name: "semantic-scholar",
  tier: 4,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      const apiUrl = `https://api.semanticscholar.org/graph/v1/paper/URL:${encodeURIComponent(url)}?fields=title,abstract,tldr,authors,year`;
      const response = await fetchWithTimeout(apiUrl, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as SemanticScholarResponse;
      if (!data.title && !data.abstract) return null;
      const parts: string[] = [];
      if (data.title) parts.push(`# ${data.title}`);
      if (data.authors?.length)
        parts.push(
          `**Authors:** ${data.authors.map((a) => a.name).join(", ")}`,
        );
      if (data.year) parts.push(`**Year:** ${data.year}`);
      if (data.tldr?.text) parts.push("", "## TL;DR", "", data.tldr.text);
      if (data.abstract) parts.push("", "## Abstract", "", data.abstract);
      const content = parts.join("\n");
      return {
        content,
        source: "semantic-scholar",
        quality: scoreContent(content),
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
