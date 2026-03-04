#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { normalizeUrl } from "./normalize.js";
import { runPipeline, formatResult } from "./pipeline.js";
import { routeUrl } from "./router.js";
import { LRUCache } from "./cache.js";
import { jinaFetcher } from "./fetchers/jina.js";
import { archivePhFetcher } from "./fetchers/archive-ph.js";
import { waybackFetcher } from "./fetchers/wayback.js";
import { rawFetcher } from "./fetchers/raw.js";
import { rssFetcher } from "./fetchers/rss.js";
import { crossrefFetcher } from "./fetchers/crossref.js";
import { semanticScholarFetcher } from "./fetchers/semantic-scholar.js";
import { hackerNewsFetcher } from "./fetchers/hackernews.js";
import { redditFetcher } from "./fetchers/reddit.js";
import { ogMetaFetcher } from "./fetchers/og-meta.js";
import { twitterHandler } from "./handlers/twitter.js";
import { youtubeHandler } from "./handlers/youtube.js";
import { arxivHandler } from "./handlers/arxiv.js";
import { pdfHandler } from "./handlers/pdf.js";
import { braveSearch } from "./search/brave.js";
import { searxngSearch } from "./search/searxng.js";
import type { Fetcher, Handler } from "./types.js";
import type { SearchResponse } from "./search/brave.js";

const HANDLERS: Handler[] = [
  twitterHandler,
  youtubeHandler,
  arxivHandler,
  pdfHandler,
];

const FETCHERS: Fetcher[] = [
  jinaFetcher,
  archivePhFetcher,
  waybackFetcher,
  rawFetcher,
  rssFetcher,
  crossrefFetcher,
  semanticScholarFetcher,
  hackerNewsFetcher,
  redditFetcher,
  ogMetaFetcher,
];

const cache = new LRUCache(100);

const server = new McpServer({
  name: "intercept",
  version: "3.0.0",
});

server.registerTool(
  "fetch",
  {
    title: "Fetch URL",
    description:
      "Fetch a URL and return its content as clean markdown. Handles Twitter/X tweets, YouTube transcripts, arXiv papers, and PDFs directly. Falls back to a multi-tier chain: Jina Reader, archive.ph + Wayback (parallel), raw fetch, RSS, CrossRef, Semantic Scholar, HackerNews, Reddit, OG meta. Results are cached for the session.",
    inputSchema: {
      url: z.string().url().describe("The URL to fetch"),
      maxTier: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("Stop at this tier (1-5, default 5). Lower = faster but fewer fallbacks."),
    },
  },
  async ({ url, maxTier }) => {
    const normalizedUrl = normalizeUrl(url);

    // Check cache for known failure
    if (cache.isFailure(normalizedUrl)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch content from ${normalizedUrl}. This URL failed earlier in this session and was not re-attempted.`,
          },
        ],
      };
    }

    // Check cache for success
    const cached = cache.get(normalizedUrl);
    if (cached) {
      const original = cached.result.source;
      return {
        content: [
          {
            type: "text" as const,
            text: formatResult({
              ...cached,
              result: { ...cached.result, source: `cache (${original})` },
            }),
          },
        ],
      };
    }

    // Try site-specific handlers
    const handlerResult = await routeUrl(normalizedUrl, HANDLERS);
    if (handlerResult) {
      const pipelineResult = {
        result: { content: handlerResult.content, source: handlerResult.source, quality: 1.0, timing: handlerResult.timing },
        attempts: [{ name: handlerResult.source, status: "success" as const, quality: 1.0, timing: handlerResult.timing }],
      };
      cache.set(normalizedUrl, pipelineResult);
      return {
        content: [
          {
            type: "text" as const,
            text: formatResult(pipelineResult),
          },
        ],
      };
    }

    // Fall through to pipeline
    const pipelineResult = await runPipeline(normalizedUrl, FETCHERS, {
      maxTier: maxTier ?? 5,
    });

    if (pipelineResult.result.source === "none") {
      cache.setFailure(normalizedUrl);
    } else {
      cache.set(normalizedUrl, pipelineResult);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatResult(pipelineResult),
        },
      ],
    };
  }
);

function formatSearchResult(searchResult: SearchResponse): string {
  const lines: string[] = [];
  lines.push(`# Search: ${searchResult.source}`);
  lines.push("");

  searchResult.results.forEach((r, i) => {
    lines.push(`${i + 1}. **[${r.title}](${r.url})**`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    lines.push("");
  });

  lines.push("---");
  lines.push(`source: ${searchResult.source}`);
  lines.push(`results: ${searchResult.results.length}`);
  lines.push(`time: ${searchResult.timing >= 1000 ? `${(searchResult.timing / 1000).toFixed(1)}s` : `${searchResult.timing}ms`}`);

  return lines.join("\n");
}

server.registerTool(
  "search",
  {
    title: "Web Search",
    description:
      "Search the web and return results. Uses Brave Search API if BRAVE_API_KEY is set, otherwise falls back to SearXNG. Set BRAVE_API_KEY for best results (free tier: 2,000 queries/month).",
    inputSchema: {
      query: z.string().describe("Search query"),
      count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("Number of results (1-20, default 5)"),
    },
  },
  async ({ query, count }) => {
    let searchResult: SearchResponse | null = null;

    const braveKey = process.env.BRAVE_API_KEY;
    if (braveKey) {
      searchResult = await braveSearch(query, braveKey, count);
    }

    if (!searchResult) {
      const searxngUrl = process.env.SEARXNG_URL || "https://search.sapti.me";
      searchResult = await searxngSearch(query, searxngUrl, count);
    }

    if (!searchResult) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Search failed. No search backend available. Set BRAVE_API_KEY or SEARXNG_URL environment variable.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatSearchResult(searchResult),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
