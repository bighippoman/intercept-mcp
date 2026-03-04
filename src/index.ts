#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { normalizeUrl } from "./normalize.js";
import { runPipeline, formatResult } from "./pipeline.js";
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
import type { Fetcher } from "./types.js";

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

const server = new McpServer({
  name: "intercept",
  version: "2.0.0",
});

server.registerTool(
  "fetch",
  {
    title: "Fetch URL",
    description:
      "Fetch a URL and return its content as clean markdown. Uses a multi-tier fallback chain: Jina Reader, archive.ph, Wayback Machine, raw fetch with browser headers, RSS, CrossRef/DOI, Semantic Scholar, HackerNews, Reddit, OG meta tags. Always returns something useful.",
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
    const pipelineResult = await runPipeline(normalizedUrl, FETCHERS, {
      maxTier: maxTier ?? 5,
    });

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

const transport = new StdioServerTransport();
await server.connect(transport);
