import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { withRequestDeadline, throwIfCancelled, requestSignal } from "./request-context.js";
import { relevantPassages } from "./passages.js";
import { ProviderHealth } from "./provider-health.js";
import { SingleFlight } from "./single-flight.js";
import { normalizeUrl } from "./normalize.js";
import { runPipeline, formatResult } from "./pipeline.js";
import { routeUrl } from "./router.js";
import { LRUCache } from "./cache.js";
import { blockedUrlReason } from "./url-guard.js";
import { hasAuthFor } from "./auth.js";
import { fetchWithTimeout } from "./fetch-with-timeout.js";
import { extractFromHtml } from "./extract.js";
import { detectBlock, buildDiagnosis } from "./classify.js";
import { isImageUrl, fetchImage, type ImageResult } from "./image-fetch.js";
import { sliceWithNotice, DEFAULT_MAX_LENGTH, DEFAULT_BATCH_MAX_LENGTH, type ContentSlice } from "./truncate.js";
import { cloudflareFetcher } from "./fetchers/cloudflare.js";
import { jinaFetcher } from "./fetchers/jina.js";
import { waybackFetcher } from "./fetchers/wayback.js";
import { archivePhFetcher } from "./fetchers/archive-ph.js";
import { arquivoFetcher } from "./fetchers/arquivo.js";
import { commonCrawlFetcher } from "./fetchers/common-crawl.js";
import { codetabsFetcher } from "./fetchers/codetabs.js";
import { markdownEndpointFetcher } from "./fetchers/markdown-endpoint.js";
import { rawFetcher } from "./fetchers/raw.js";
import { stealthFetcher } from "./fetchers/stealth.js";
import { flaresolverrFetcher } from "./fetchers/flaresolverr.js";
import { webUnlockerFetcher } from "./fetchers/web-unlocker.js";
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
import { wikipediaHandler } from "./handlers/wikipedia.js";
import { githubHandler } from "./handlers/github.js";
import { braveSearch } from "./search/brave.js";
import { searxngSearch } from "./search/searxng.js";
import { duckduckgoSearch } from "./search/duckduckgo.js";
import { sharedCacheRead, sharedCacheWrite } from "./shared-cache.js";
import type { Fetcher, Handler, PipelineResult, SearchOptions, SearchResponse } from "./types.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../package.json") as { version: string };

const HANDLERS: Handler[] = [
  twitterHandler,
  youtubeHandler,
  arxivHandler,
  pdfHandler,
  wikipediaHandler,
  githubHandler,
];

// Prefer native/live retrieval. Archives remain a clearly labeled fallback.
const FETCHERS: Fetcher[] = [
  markdownEndpointFetcher, rawFetcher, cloudflareFetcher, jinaFetcher,
  stealthFetcher, codetabsFetcher, flaresolverrFetcher, webUnlockerFetcher,
  waybackFetcher, arquivoFetcher, commonCrawlFetcher, archivePhFetcher,
  rssFetcher, crossrefFetcher, semanticScholarFetcher, hackerNewsFetcher,
  redditFetcher, ogMetaFetcher,
];

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

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

interface FetchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxAgeSeconds?: number;
  allowArchive?: boolean;
  health?: ProviderHealth;
  maxTier?: number;
  noCache?: boolean;
  /** Return direct image URLs as an image content block (default true). */
  allowImage?: boolean;
}

interface FetchOutcome {
  ok: boolean;
  pipelineResult: PipelineResult;
  image?: ImageResult;
}

function failureOutcome(content: string, attemptName?: string): FetchOutcome {
  return {
    ok: false,
    pipelineResult: {
      result: { content, source: "none", quality: 0, timing: 0 },
      attempts: attemptName ? [{ name: attemptName, status: "failed" as const, reason: content }] : [],
    },
  };
}

/**
 * The full fetch flow for one normalized URL: SSRF guard, failure cache,
 * session cache, specialized handlers, shared cache, fetcher pipeline.
 * Shared by the fetch, fetch_batch, and research tools. Never throws.
 */
async function performFetchInner(
  cache: LRUCache,
  normalizedUrl: string,
  options: FetchOptions = {},
): Promise<FetchOutcome> {
  const { maxTier = 5, noCache = false, allowImage = true, maxAgeSeconds = 3600, allowArchive = !noCache, health } = options;
  throwIfCancelled();
  const failureKey = `${normalizedUrl}#policy:${maxTier}:${allowArchive}:${maxAgeSeconds}`;

  const blocked = blockedUrlReason(normalizedUrl);
  if (blocked) {
    return failureOutcome(`Refusing to fetch ${normalizedUrl}: ${blocked}. Private, local, and reserved addresses are not fetchable.`, "url-guard");
  }

  // Direct image URLs have no extractable text — hand the image to the agent's
  // vision model instead. Bypasses the text pipeline and cache (base64 is heavy).
  if (allowImage && isImageUrl(normalizedUrl)) {
    const image = await fetchImage(normalizedUrl);
    if (image) {
      const note = `Image fetched from ${normalizedUrl} (${image.mimeType}, ${Math.round(image.bytes / 1024)} KB). Rendered as an image block for vision.`;
      return {
        ok: true,
        image,
        pipelineResult: {
          result: { content: note, source: "image", quality: 1, timing: 0 },
          attempts: [{ name: "image", status: "success" as const, quality: 1, timing: 0 }],
        },
      };
    }
    // Not a usable image (HTML error page, oversized, unsupported) — fall through.
  }

  if (!noCache) {
    if (cache.isFailure(failureKey)) {
      return failureOutcome(
        `Failed to fetch content from ${normalizedUrl}. This URL failed earlier in this session and was not re-attempted. Pass noCache: true to force a retry.`,
        "session-cache",
      );
    }

    const cached = cache.get(normalizedUrl);
    const cachedAge = cached?.result.retrievedAt ? (Date.now() - Date.parse(cached.result.retrievedAt)) / 1000 : Infinity;
    if (cached && cachedAge <= maxAgeSeconds && (allowArchive || cached.result.sourceKind !== "archive")) {
      const original = cached.result.source;
      return {
        ok: true,
        pipelineResult: {
          ...cached,
          result: { ...cached.result, ageSeconds: Math.max(0, cachedAge), source: `cache (${original})` },
        },
      };
    }
  }

  // Per-domain credentials are in play: the response is the user's private,
  // authenticated view, so it must never be read from or written to the public
  // shared cache (don't publish private content; don't serve an anonymous copy
  // in its place). The in-process session cache is fine.
  const authed = hasAuthFor(normalizedUrl);
  const sensitiveUrl = /(?:[?&](?:token|sig|signature|access_token|key|api_key|x-amz-[^=]+|x-goog-[^=]+)=)|^https?:\/\/[^/]*@/i.test(normalizedUrl);
  const githubToken = !!process.env.GITHUB_TOKEN && /(^|\.)github\.com$/.test(new URL(normalizedUrl).hostname);
  const useSharedCache = !authed && !githubToken && !sensitiveUrl && process.env.INTERCEPT_SHARED_CACHE !== "false";

  // Specialized handlers first — they produce structured, high-quality output
  const handlerResult = await routeUrl(normalizedUrl, authed || sensitiveUrl ? [pdfHandler] : HANDLERS);
  throwIfCancelled();
  if (handlerResult?.completeness === "unavailable") return failureOutcome(handlerResult.content, handlerResult.source);
  if (handlerResult) {
    const metadata = handlerResult.sourceKind === "metadata" || handlerResult.source === "arxiv";
    const pipelineResult: PipelineResult = {
      result: enrichResult({ ...handlerResult, quality: metadata ? 0.5 : 0.9, completeness: handlerResult.completeness ?? (metadata ? "partial" : "complete"), sourceKind: metadata ? "metadata" : "live" }, normalizedUrl),
      attempts: [{ name: handlerResult.source, status: "success" as const, quality: 1.0, timing: handlerResult.timing }],
    };
    cache.set(normalizedUrl, pipelineResult);
    // Contribute to shared cache (fire-and-forget)
    if (useSharedCache && pipelineResult.result.completeness === "complete" && process.env.INTERCEPT_CACHE_READ_ONLY !== "true") {
      sharedCacheWrite(normalizedUrl, handlerResult.content, handlerResult.source);
    }
    return { ok: true, pipelineResult };
  }

  // Shared agentsweb.org cache — checked after handlers but before the fetcher pipeline
  if (!noCache && useSharedCache) {
    const sharedResult = await sharedCacheRead(normalizedUrl, { maxAgeSeconds, allowArchive });
    if (sharedResult && sharedResult.quality >= 0.3) {
      const pipelineResult: PipelineResult = {
        result: sharedResult,
        attempts: [{ name: "agentsweb", status: "success" as const, quality: sharedResult.quality, timing: sharedResult.timing }],
      };
      cache.set(normalizedUrl, pipelineResult);


      return { ok: true, pipelineResult };
    }
  }

  // Authenticated pages must use direct origin requests, never anonymous intermediaries.
  const fetchers = authed || githubToken || sensitiveUrl ? [markdownEndpointFetcher, rawFetcher] : FETCHERS;
  const pipelineResult = await runPipeline(normalizedUrl, fetchers, { maxTier, allowArchive, health: authed ? undefined : health });
  throwIfCancelled();
  pipelineResult.result = enrichResult(pipelineResult.result, normalizedUrl);

  if (pipelineResult.result.source === "none") {
    cache.setFailure(failureKey);
    return { ok: false, pipelineResult };
  }

  cache.set(normalizedUrl, pipelineResult);

  // Contribute to shared cache (fire-and-forget)
  if (useSharedCache && pipelineResult.result.completeness === "complete" && pipelineResult.result.sourceKind === "live" && process.env.INTERCEPT_CACHE_READ_ONLY !== "true") {
    sharedCacheWrite(normalizedUrl, pipelineResult.result.content, pipelineResult.result.source);
  }

  return { ok: true, pipelineResult };
}

const flights = new WeakMap<LRUCache, SingleFlight<FetchOutcome>>();

function enrichResult(result: PipelineResult["result"], url: string): PipelineResult["result"] {
  const sourceKind = result.sourceKind ?? (/^(wayback|arquivo|archive-ph|common-crawl)$/.test(result.source) ? "archive" : /^(og-meta|crossref|semantic-scholar|hackernews|reddit|arxiv)$/.test(result.source) ? "metadata" : "live");
  return {
    ...result, sourceKind,
    completeness: result.completeness ?? (result.source === "none" ? "unavailable" : sourceKind === "metadata" ? "partial" : "complete"),
    canonicalUrl: result.canonicalUrl ?? url,
    retrievedAt: result.retrievedAt ?? new Date().toISOString(),
    contentHash: result.contentHash ?? createHash("sha256").update(result.content).digest("hex"),
    title: result.title ?? result.content.match(/^#\s+(.+)$/m)?.[1],
  };
}

export async function performFetch(cache: LRUCache, url: string, options: FetchOptions = {}): Promise<FetchOutcome> {
  options = { ...options, noCache: options.noCache || options.maxAgeSeconds === 0 };
  const parent = requestSignal();
  if (parent) options.signal = options.signal ? AbortSignal.any([parent, options.signal]) : parent;
  let flight = flights.get(cache);
  if (!flight) { flight = new SingleFlight(); flights.set(cache, flight); }
  const key = JSON.stringify([url, options.maxTier, options.noCache, options.allowImage, options.maxAgeSeconds, options.allowArchive, options.timeoutMs]);
  try {
    return await flight.run(key, options.signal, (signal) =>
      withRequestDeadline(options.timeoutMs ?? 25_000, signal, () => performFetchInner(cache, url, options)));
  } catch (error) {
    return failureOutcome(error instanceof Error ? error.message : "Retrieval cancelled or deadline exceeded", "deadline");
  }
}

/** Slice the result content and render it with the attempt-chain footer. */
function renderFetchText(pipelineResult: PipelineResult, maxLength: number, startIndex: number): { text: string; slice: ContentSlice } {
  const slice = sliceWithNotice(pipelineResult.result.content, maxLength, startIndex);
  const text = formatResult({
    ...pipelineResult,
    result: { ...pipelineResult.result, content: slice.text, completeness: slice.returnedLength < slice.totalLength ? "partial" : pipelineResult.result.completeness },
  });
  return { text, slice };
}

function fetchStructured(url: string, outcome: FetchOutcome, slice: ContentSlice) {
  const { result } = outcome.pipelineResult;
  return {
    url,
    source: result.source,
    quality: result.quality,
    timing: result.timing,
    completeness: slice.returnedLength < slice.totalLength ? "partial" : result.completeness ?? "complete",
    sourceKind: result.sourceKind ?? "live",
    retrievedAt: result.retrievedAt,
    verifiedAt: result.verifiedAt,
    canonicalUrl: result.canonicalUrl ?? url,
    contentHash: result.contentHash,
    archivedAt: result.archivedAt,
    title: result.title,
    contentLength: slice.totalLength,
    returnedLength: slice.returnedLength,
    truncated: slice.truncated,
    ...(slice.nextStartIndex !== undefined ? { nextStartIndex: slice.nextStartIndex } : {}),
    ...(result.ageSeconds !== undefined ? { cacheAgeSeconds: result.ageSeconds } : {}),
  };
}

async function runSearch(query: string, count: number, options: SearchOptions & { site?: string } = {}): Promise<SearchResponse | null> {
  const effectiveQuery = options.site ? `site:${options.site} ${query}` : query;
  const backendOptions: SearchOptions = { freshness: options.freshness, page: options.page };

  let searchResult: SearchResponse | null = null;

  const braveKey = process.env.BRAVE_API_KEY;
  if (braveKey) {
    searchResult = await braveSearch(effectiveQuery, braveKey, count, backendOptions);
  }

  if (!searchResult) {
    const searxngUrl = process.env.SEARXNG_URL || "https://search.sapti.me";
    searchResult = await searxngSearch(effectiveQuery, searxngUrl, count, backendOptions);
  }

  if (!searchResult) {
    searchResult = await duckduckgoSearch(effectiveQuery, count);
  }

  return searchResult;
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Fetch a page's raw HTML for structured extraction (honors SSRF guard, auth, proxy). */
async function fetchPageHtml(url: string): Promise<{ html: string } | { error: string }> {
  const blocked = blockedUrlReason(url);
  if (blocked) return { error: `Refusing to fetch ${url}: ${blocked}.` };

  try {
    const response = await fetchWithTimeout(url, { headers: BROWSER_HEADERS, redirect: "follow" }, 15_000);
    if (!response.ok) return { error: `Could not fetch ${url} — HTTP ${response.status}.` };
    const html = await response.text();
    if (!html) return { error: `Could not fetch ${url} — empty response.` };

    const reason = detectBlock(html);
    if (reason) {
      const diagnosis = buildDiagnosis([reason]);
      return { error: `Could not extract from ${url}. ${diagnosis ?? "The page was blocked."}` };
    }
    return { html };
  } catch (error) {
    return { error: `Could not fetch ${url} — ${error instanceof Error ? error.message : "network error"}.` };
  }
}

const freshnessSchema = z
  .enum(["day", "week", "month", "year"])
  .optional()
  .describe("Only return results from the last day/week/month/year (ignored by the DuckDuckGo fallback)");

export function createServer(): McpServer {
  const cache = new LRUCache(envInt("INTERCEPT_CACHE_SIZE", 250), {
    ttl: envInt("INTERCEPT_CACHE_TTL_MS", 60 * 60_000),
    failureTtl: envInt("INTERCEPT_CACHE_FAILURE_TTL_MS", 5 * 60_000),
  });

  const health = new ProviderHealth();

  const server = new McpServer({
    name: "intercept",
    version: PKG_VERSION,
  });

  const retrievalInputs = {
    timeoutMs: z.number().int().min(500).max(120_000).optional().describe("Overall retrieval deadline in milliseconds, including downloads (default 25000)"),
    maxAgeSeconds: z.number().int().min(0).max(2_592_000).optional().describe("Oldest acceptable cached retrieval in seconds; 0 forces retrieval (default 3600)"),
    allowArchive: z.boolean().optional().describe("Allow labeled historical snapshots after live retrieval fails; disabled by noCache unless explicitly enabled"),
  };

  const fetchOutputSchema = {
    completeness: z.enum(["complete", "partial", "unavailable"]).optional(),
    sourceKind: z.enum(["live", "archive", "metadata", "image"]).optional(),
    retrievedAt: z.string().optional(),
    verifiedAt: z.string().optional(),
    canonicalUrl: z.string().optional(),
    contentHash: z.string().optional(),
    archivedAt: z.string().optional(),
    title: z.string().optional(),
    url: z.string(),
    source: z.string(),
    quality: z.number(),
    timing: z.number(),
    contentLength: z.number().describe("Full length of the fetched content in characters"),
    returnedLength: z.number(),
    truncated: z.boolean(),
    nextStartIndex: z.number().optional().describe("Pass as startIndex to fetch the next chunk"),
    cacheAgeSeconds: z.number().optional().describe("Age of the content when served from the shared cache"),
    mimeType: z.string().optional().describe("Set when the URL is an image returned as an image block"),
    bytes: z.number().optional().describe("Image size in bytes, when an image was returned"),
  };

  server.registerTool(
    "fetch",
    {
      title: "Fetch URL",
      description:
        "Fetch a public or authenticated URL as readable Markdown, with source, retrieval time, content hash and completeness. Specialized handlers support GitHub, Wikipedia, YouTube transcripts, PDFs, arXiv and tweets. Otherwise checks fresh shared content, then native Markdown/direct HTML, hosted rendering, and labeled archive fallbacks. Authenticated requests use direct sources only. Paginate long pages with startIndex and maxLength. noCache forces retrieval and disables archives unless explicitly allowed.",
      inputSchema: {
        ...retrievalInputs,
        url: z.string().url().describe("The URL to fetch"),
        maxTier: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Stop at this tier (1-5, default 5). Lower = faster but fewer fallbacks."),
        maxLength: z
          .number()
          .int()
          .min(100)
          .max(1_000_000)
          .optional()
          .describe(`Maximum characters to return (default ${DEFAULT_MAX_LENGTH})`),
        startIndex: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Character offset to start from, for paginating long content (default 0)"),
        noCache: z
          .boolean()
          .optional()
          .describe("Skip session and shared caches and fetch live content"),
      },
      outputSchema: fetchOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, maxTier, maxLength, startIndex, noCache, timeoutMs, maxAgeSeconds, allowArchive }, extra) => {
      const normalizedUrl = normalizeUrl(url);
      const outcome = await performFetch(cache, normalizedUrl, { maxTier, noCache: noCache || maxAgeSeconds === 0, timeoutMs, maxAgeSeconds, allowArchive, signal: extra.signal, health });

      if (!outcome.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: formatResult(outcome.pipelineResult) }],
        };
      }

      if (outcome.image) {
        const { result } = outcome.pipelineResult;
        return {
          structuredContent: {
            url: normalizedUrl,
            source: result.source,
            quality: result.quality,
            timing: result.timing,
            contentLength: 0,
            returnedLength: 0,
            truncated: false,
            mimeType: outcome.image.mimeType,
            bytes: outcome.image.bytes,
          },
          content: [
            { type: "image" as const, data: outcome.image.data, mimeType: outcome.image.mimeType },
            { type: "text" as const, text: result.content },
          ],
        };
      }

      const { text, slice } = renderFetchText(outcome.pipelineResult, maxLength ?? DEFAULT_MAX_LENGTH, startIndex ?? 0);
      return {
        structuredContent: fetchStructured(normalizedUrl, outcome, slice),
        content: [{ type: "text" as const, text }],
      };
    }
  );

  server.registerTool(
    "fetch_batch",
    {
      title: "Fetch multiple URLs",
      description:
        "Fetch up to 10 URLs in parallel and return each as clean markdown. Same handler/fallback chain as the fetch tool, with a smaller per-URL length budget. Use after a search to pull several sources in one call.",
      inputSchema: {
        ...retrievalInputs,
        urls: z.array(z.string().url()).min(1).max(10).describe("The URLs to fetch (1-10)"),
        maxTier: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Stop at this tier (1-5, default 5). Lower = faster but fewer fallbacks."),
        maxLength: z
          .number()
          .int()
          .min(100)
          .max(200_000)
          .optional()
          .describe(`Maximum characters to return per URL (default ${DEFAULT_BATCH_MAX_LENGTH})`),
        noCache: z
          .boolean()
          .optional()
          .describe("Skip session and shared caches and fetch live content"),
      },
      outputSchema: {
        results: z.array(
          z.object({
            url: z.string(),
            ok: z.boolean(),
            source: z.string(),
            quality: z.number(),
            contentLength: z.number(),
            truncated: z.boolean(),
          })
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ urls, maxTier, maxLength, noCache, timeoutMs, maxAgeSeconds, allowArchive }, extra) => {
      const perUrlLength = maxLength ?? DEFAULT_BATCH_MAX_LENGTH;
      const normalized = [...new Set(urls.map(normalizeUrl))];

      const outcomes = await Promise.all(
        normalized.map((u) => performFetch(cache, u, { maxTier, noCache: noCache || maxAgeSeconds === 0, timeoutMs, maxAgeSeconds, allowArchive, signal: extra.signal, health, allowImage: false }))
      );

      const sections: string[] = [];
      const structured: Array<{ url: string; ok: boolean; source: string; quality: number; contentLength: number; truncated: boolean }> = [];

      for (let i = 0; i < normalized.length; i++) {
        const url = normalized[i];
        const outcome = outcomes[i];
        const { text, slice } = renderFetchText(outcome.pipelineResult, perUrlLength, 0);

        sections.push(`## ${url}\n\n${text}`);
        structured.push({
          url,
          ok: outcome.ok,
          source: outcome.pipelineResult.result.source,
          quality: outcome.pipelineResult.result.quality,
          contentLength: slice.totalLength,
          truncated: slice.truncated,
        });
      }

      const okCount = structured.filter((r) => r.ok).length;
      const header = `# Batch fetch: ${okCount}/${normalized.length} succeeded\n\n`;

      return {
        isError: okCount === 0 ? true : undefined,
        structuredContent: { results: structured },
        content: [{ type: "text" as const, text: header + sections.join("\n\n") }],
      };
    }
  );

  server.registerTool(
    "research",
    {
      title: "Research a query",
      description:
        "Search the web and fetch the content of the top results in one call. Returns the full content of each result as markdown, ready to summarize or compare. Use this instead of separate search + fetch calls when researching a topic.",
      inputSchema: {
        passagesOnly: z.boolean().optional().describe("Return query-relevant verbatim passages instead of full documents"),
        timeoutMs: retrievalInputs.timeoutMs,
        query: z.string().describe("Search query"),
        count: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .default(3)
          .describe("Number of top results to fetch (1-5, default 3)"),
        maxLength: z
          .number()
          .int()
          .min(100)
          .max(200_000)
          .optional()
          .describe(`Maximum characters to return per result (default ${DEFAULT_BATCH_MAX_LENGTH})`),
        site: z.string().optional().describe("Restrict results to a domain, e.g. \"docs.python.org\""),
        freshness: freshnessSchema,
      },
      outputSchema: {
        query: z.string(),
        searchSource: z.string(),
        results: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            fetched: z.boolean(),
            source: z.string(),
            quality: z.number(),
            completeness: z.string().optional(),
            retrievedAt: z.string().optional(),
            contentHash: z.string().optional(),
            passages: z.array(z.object({text:z.string(),heading:z.string(),startIndex:z.number(),endIndex:z.number(),citationUrl:z.string()})).optional(),
          })
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, count, maxLength, site, freshness, timeoutMs, passagesOnly }, extra) => withRequestDeadline(timeoutMs ?? 35_000, extra.signal, async () => {
      const progressToken = extra._meta?.progressToken;
      if (progressToken !== undefined) await extra.sendNotification({method:"notifications/progress",params:{progressToken,progress:0,total:count+1,message:"Finding sources"}});
      const searchResult = await runSearch(query, count, { site, freshness });

      if (!searchResult || searchResult.results.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Research failed: no search results. All search backends unavailable or the query returned nothing. Optionally set BRAVE_API_KEY or SEARXNG_URL for more reliable search.",
            },
          ],
        };
      }

      const perUrlLength = maxLength ?? DEFAULT_BATCH_MAX_LENGTH;
      const top = searchResult.results.slice(0, count);
      const outcomes = await Promise.all(
        top.map((r) => performFetch(cache, normalizeUrl(r.url), { allowImage: false, signal: extra.signal, health }))
      );

      const sections: string[] = [`# Research: ${query}`, `search source: ${searchResult.source}`, ""];
      const structured: Array<Record<string, unknown>> = [];

      for (let i = 0; i < top.length; i++) {
        const r = top[i];
        const outcome = outcomes[i];
        const { text: fullText, slice } = renderFetchText(outcome.pipelineResult, perUrlLength, 0);
        const passages = outcome.ok ? relevantPassages(outcome.pipelineResult.result.content,query,r.url) : [];
        const text = passagesOnly && passages.length ? passages.map((p,j)=>`### Passage ${j+1}: ${p.heading}\n${p.citationUrl}\n\n${p.text}`).join("\n\n") : fullText;

        sections.push(`## ${i + 1}. ${r.title}\n${r.url}\n\n${text}`);
        structured.push({
          title: r.title,
          url: r.url,
          fetched: outcome.ok,
          source: outcome.pipelineResult.result.source,
          quality: outcome.pipelineResult.result.quality,
          completeness: (passagesOnly && passages.length) || slice.returnedLength < slice.totalLength ? "partial" : outcome.pipelineResult.result.completeness,
          retrievedAt: outcome.pipelineResult.result.retrievedAt,
          contentHash: outcome.pipelineResult.result.contentHash,
          passages,
        });
      }

      if (progressToken !== undefined) await extra.sendNotification({method:"notifications/progress",params:{progressToken,progress:count+1,total:count+1,message:"Sources ready"}});
      return {
        structuredContent: { query, searchSource: searchResult.source, results: structured },
        content: [{ type: "text" as const, text: sections.join("\n\n") }],
      };
    }).catch(error => ({isError:true,content:[{type:"text" as const,text:`Research stopped: ${error instanceof Error ? error.message : "cancelled"}`}]}))
  );

  server.registerTool(
    "search",
    {
      title: "Web Search",
      description:
        "Search the web and return results. Uses Brave Search API if BRAVE_API_KEY is set, otherwise falls back to SearXNG and then DuckDuckGo. Supports domain filtering (site), freshness, and pagination (page).",
      inputSchema: {
        timeoutMs: retrievalInputs.timeoutMs,
        query: z.string().describe("Search query"),
        count: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(5)
          .describe("Number of results (1-20, default 5)"),
        site: z.string().optional().describe("Restrict results to a domain, e.g. \"github.com\""),
        freshness: freshnessSchema,
        page: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("1-based results page for pagination (default 1; ignored by the DuckDuckGo fallback)"),
      },
      outputSchema: {
        results: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            snippet: z.string(),
          })
        ),
        source: z.string(),
        timing: z.number(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ query, count, site, freshness, page, timeoutMs }, extra) => withRequestDeadline(timeoutMs ?? 25_000, extra.signal, async () => {
      const searchResult = await runSearch(query, count, { site, freshness, page });

      if (!searchResult) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Search failed. All search backends unavailable. Optionally set BRAVE_API_KEY or SEARXNG_URL for more reliable search.",
            },
          ],
        };
      }

      return {
        structuredContent: {
          results: searchResult.results,
          source: searchResult.source,
          timing: searchResult.timing,
        },
        content: [
          {
            type: "text" as const,
            text: formatSearchResult(searchResult),
          },
        ],
      };
    }).catch(error => ({isError:true,content:[{type:"text" as const,text:`Search stopped: ${error instanceof Error ? error.message : "cancelled"}`}]}))
  );

  server.registerTool(
    "extract",
    {
      title: "Extract structured data",
      description:
        "Extract specific values from a web page as JSON instead of markdown prose. Provide CSS selectors to pull named fields (text or an attribute, first match or all), and/or set tables:true to convert every HTML table to arrays of row objects. Use this when you need particular data (prices, lists, specs, tabular data) rather than the whole page. Honors per-domain auth and proxies.",
      inputSchema: {
        timeoutMs: retrievalInputs.timeoutMs,
        url: z.string().url().describe("The URL to extract from"),
        selectors: z
          .record(
            z.string(),
            z.union([
              z.string(),
              z.object({
                selector: z.string(),
                attr: z.string().optional().describe("Extract this attribute (e.g. href, src) instead of text"),
                all: z.boolean().optional().describe("Return every match as an array instead of the first"),
              }),
            ])
          )
          .optional()
          .describe('Map of field name to CSS selector, e.g. {"title":"h1","price":".price","links":{"selector":"a.item","attr":"href","all":true}}'),
        tables: z.boolean().optional().describe("Extract all HTML tables as arrays of row objects (default true when no selectors are given)"),
      },
      outputSchema: {
        url: z.string(),
        fields: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.null()])).optional(),
        tables: z.array(z.array(z.record(z.string(), z.string()))).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, selectors, tables, timeoutMs }, extra) => withRequestDeadline(timeoutMs ?? 25_000, extra.signal, async () => {
      const normalizedUrl = normalizeUrl(url);
      const page = await fetchPageHtml(normalizedUrl);
      if ("error" in page) {
        return { isError: true, content: [{ type: "text" as const, text: page.error }] };
      }

      const wantTables = tables ?? !selectors;
      const result = extractFromHtml(page.html, selectors, wantTables);

      const structured: { url: string; fields?: typeof result.fields; tables?: typeof result.tables } = { url: normalizedUrl };
      if (result.fields) structured.fields = result.fields;
      if (result.tables) structured.tables = result.tables;

      const tableCount = result.tables?.length ?? 0;
      const fieldCount = result.fields ? Object.keys(result.fields).length : 0;
      const summary = `# Extracted from ${normalizedUrl}\n\n${fieldCount} field(s), ${tableCount} table(s).\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;

      return {
        structuredContent: structured,
        content: [{ type: "text" as const, text: summary }],
      };
    }).catch(error => ({isError:true,content:[{type:"text" as const,text:`Extraction stopped: ${error instanceof Error ? error.message : "cancelled"}`}]}))
  );

  server.registerResource(
    "recent-fetches",
    "intercept://session/recent",
    {
      title: "Recently fetched URLs",
      description: "URLs fetched and cached in this session, most recent first. Re-fetching any of these is instant.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const entries = cache.list();
      const lines = ["# Recently fetched URLs", ""];
      if (entries.length === 0) {
        lines.push("*No URLs fetched yet this session.*");
      } else {
        for (const e of entries) {
          lines.push(`- ${e.url} — source: ${e.source}, quality: ${e.quality}`);
        }
      }
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: lines.join("\n") }],
      };
    }
  );

  server.registerPrompt(
    "research-topic",
    {
      title: "Research Topic",
      description:
        "Search for a topic and fetch the top results. Provides a multi-source summary.",
      argsSchema: {
        topic: z.string().describe("The topic to research"),
        depth: z
          .string()
          .optional()
          .default("3")
          .describe("Number of top results to fetch (default: 3)"),
      },
    },
    ({ topic, depth }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Search for "${topic}" and fetch the top ${depth} results. For each result, provide a brief summary of the key points. Compare perspectives across sources where relevant.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "extract-article",
    {
      title: "Extract Article",
      description:
        "Fetch a URL and extract the key points from the content.",
      argsSchema: {
        url: z.string().describe("The URL to fetch and summarize"),
      },
    },
    ({ url }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Fetch the content from ${url} and extract the key points. Summarize the main arguments, findings, or information presented.`,
          },
        },
      ],
    })
  );

  return server;
}
