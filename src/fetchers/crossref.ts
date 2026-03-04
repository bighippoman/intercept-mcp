import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

const DOI_PATTERN = /(?:doi\.org\/|doi:)(10\.\d{4,}\/[^\s]+)/i;

function extractDoi(url: string): string | null {
  const match = url.match(DOI_PATTERN);
  return match ? match[1] : null;
}

interface CrossRefResponse {
  message: {
    title?: string[];
    abstract?: string;
    author?: Array<{ given?: string; family?: string }>;
    published?: { "date-parts"?: number[][] };
    "container-title"?: string[];
  };
}

export const crossrefFetcher: Fetcher = {
  name: "crossref",
  tier: 4,
  async fetch(url: string): Promise<FetchResult | null> {
    const doi = extractDoi(url);
    if (!doi) return null;
    const start = Date.now();
    try {
      const response = await fetch(`https://api.crossref.org/works/${doi}`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as CrossRefResponse;
      const msg = data.message;
      const parts: string[] = [];
      if (msg.title?.[0]) parts.push(`# ${msg.title[0]}`);
      if (msg.author?.length) {
        const authors = msg.author
          .map((a) => [a.given, a.family].filter(Boolean).join(" "))
          .join(", ");
        parts.push(`**Authors:** ${authors}`);
      }
      if (msg["container-title"]?.[0])
        parts.push(`**Published in:** ${msg["container-title"][0]}`);
      if (msg.published?.["date-parts"]?.[0]) {
        const [year, month] = msg.published["date-parts"][0];
        parts.push(
          `**Date:** ${year}${month ? `-${String(month).padStart(2, "0")}` : ""}`,
        );
      }
      if (msg.abstract) parts.push("", "## Abstract", "", msg.abstract);
      const content = parts.join("\n");
      return {
        content,
        source: "crossref",
        quality: scoreContent(content),
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
