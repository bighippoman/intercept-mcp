/**
 * End-to-end tests hitting real URLs over the network.
 * No mocks. These test the actual fetchers, handlers, pipeline, and server.
 *
 * Marked with a long timeout since network requests can be slow.
 * Individual tests use `skip` if the service is clearly down rather than failing the suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { jinaFetcher } from "../fetchers/jina.js";
import { rawFetcher } from "../fetchers/raw.js";
import { waybackFetcher } from "../fetchers/wayback.js";
import { codetabsFetcher } from "../fetchers/codetabs.js";
import { ogMetaFetcher } from "../fetchers/og-meta.js";
import { hackerNewsFetcher } from "../fetchers/hackernews.js";
import { crossrefFetcher } from "../fetchers/crossref.js";
import { semanticScholarFetcher } from "../fetchers/semantic-scholar.js";
import { rssFetcher } from "../fetchers/rss.js";
import { twitterHandler } from "../handlers/twitter.js";
import { youtubeHandler } from "../handlers/youtube.js";
import { arxivHandler } from "../handlers/arxiv.js";
import { pdfHandler } from "../handlers/pdf.js";
import { routeUrl } from "../router.js";
import { runPipeline } from "../pipeline.js";
import { htmlToText, extractMeta } from "../html.js";
import { scoreContent } from "../quality.js";
import { normalizeUrl } from "../normalize.js";
import { LRUCache } from "../cache.js";
import { searxngSearch } from "../search/searxng.js";
import type { Fetcher } from "../types.js";

// ─── Helpers ────────────────────────────────────────────────

function getText(result: { content: unknown }): string {
  return ((result.content as Array<{ type: string; text: string }>)[0]?.text) ?? "";
}

// ─── Server setup for protocol-level tests ──────────────────

let client: Client;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const server = createServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(ct);
  cleanup = async () => { await client.close(); await server.close(); };
}, 10_000);

afterAll(async () => { await cleanup(); });

// ═══════════════════════════════════════════════════════════════
// 1. RAW FETCHER — direct HTTP fetch + Readability extraction
// ═══════════════════════════════════════════════════════════════

describe("rawFetcher (real network)", () => {
  it("fetches example.com", async () => {
    const result = await rawFetcher.fetch("https://example.com");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Example Domain");
    expect(result!.source).toBe("raw");
    // example.com is very short (<200 chars), so quality may be 0
    expect(result!.quality).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it("fetches a Wikipedia article", async () => {
    const result = await rawFetcher.fetch("https://en.wikipedia.org/wiki/TypeScript");
    expect(result).not.toBeNull();
    expect(result!.content.length).toBeGreaterThan(500);
    expect(result!.quality).toBeGreaterThan(0.3);
  }, 15_000);

  it("fetches httpbin.org/html", async () => {
    const result = await rawFetcher.fetch("https://httpbin.org/html");
    expect(result).not.toBeNull();
    expect(result!.content.length).toBeGreaterThan(100);
  }, 15_000);

  it("returns null for 404 page", async () => {
    const result = await rawFetcher.fetch("https://httpbin.org/status/404");
    expect(result).toBeNull();
  }, 15_000);

  it("returns null for non-existent domain", async () => {
    const result = await rawFetcher.fetch("https://this-domain-definitely-does-not-exist-12345.com");
    expect(result).toBeNull();
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 2. JINA FETCHER — Jina Reader API
// ═══════════════════════════════════════════════════════════════

describe("jinaFetcher (real network)", () => {
  it("fetches example.com via Jina Reader", async () => {
    const result = await jinaFetcher.fetch("https://example.com");
    expect(result).not.toBeNull();
    expect(result!.content.length).toBeGreaterThan(50);
    expect(result!.source).toBe("jina");
  }, 15_000);

  it("returns content with quality score", async () => {
    const result = await jinaFetcher.fetch("https://en.wikipedia.org/wiki/Node.js");
    if (result) {
      expect(result.quality).toBeGreaterThanOrEqual(0);
      expect(result.quality).toBeLessThanOrEqual(1);
      expect(result.timing).toBeGreaterThan(0);
    }
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 3. OG META FETCHER — guaranteed fallback, never null
// ═══════════════════════════════════════════════════════════════

describe("ogMetaFetcher (real network)", () => {
  it("never returns null, even for broken pages", async () => {
    const result = await ogMetaFetcher.fetch("https://httpbin.org/status/500");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("og-meta");
  }, 15_000);

  it("extracts OG tags from a real page", async () => {
    const result = await ogMetaFetcher.fetch("https://github.com");
    expect(result).not.toBeNull();
    expect(result!.content.length).toBeGreaterThan(10);
  }, 15_000);

  it("returns low quality for error pages", async () => {
    const result = await ogMetaFetcher.fetch("https://httpbin.org/status/403");
    expect(result).not.toBeNull();
    // Should have very low quality
    expect(result!.quality).toBeLessThan(0.3);
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 4. WAYBACK FETCHER — Internet Archive
// ═══════════════════════════════════════════════════════════════

describe("waybackFetcher (real network)", () => {
  it("finds an archived page for a well-known URL", async () => {
    const result = await waybackFetcher.fetch("https://example.com");
    // Wayback should have example.com archived
    if (result) {
      expect(result.source).toBe("wayback");
      expect(result.content.length).toBeGreaterThan(50);
    }
    // May be null if Wayback is slow/down — that's acceptable
  }, 20_000);
});

// ═══════════════════════════════════════════════════════════════
// 5. HACKERNEWS FETCHER — Algolia search
// ═══════════════════════════════════════════════════════════════

describe("hackerNewsFetcher (real network)", () => {
  it("finds HN discussions for a famous URL", async () => {
    // This URL has been shared on HN many times
    const result = await hackerNewsFetcher.fetch("https://github.com");
    if (result) {
      expect(result.source).toBe("hackernews");
      expect(result.content).toContain("HackerNews Discussions");
    }
  }, 15_000);

  it("returns null for obscure URL with no HN posts", async () => {
    const result = await hackerNewsFetcher.fetch("https://this-page-was-never-posted-to-hn-ever.example.com/abc123");
    expect(result).toBeNull();
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 6. CROSSREF FETCHER — DOI resolution
// ═══════════════════════════════════════════════════════════════

describe("crossrefFetcher (real network)", () => {
  it("resolves a real DOI", async () => {
    // The DOI for "Attention is All You Need"
    const result = await crossrefFetcher.fetch("https://doi.org/10.48550/arXiv.1706.03762");
    if (result) {
      expect(result.source).toBe("crossref");
      expect(result.content.length).toBeGreaterThan(50);
    }
  }, 15_000);

  it("returns null for non-DOI URL", async () => {
    const result = await crossrefFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 7. ARXIV HANDLER — academic paper metadata
// ═══════════════════════════════════════════════════════════════

describe("arxivHandler (real network)", () => {
  it("extracts metadata for 'Attention is All You Need'", async () => {
    const result = await arxivHandler.handle("https://arxiv.org/abs/1706.03762");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Attention");
    expect(result!.content).toContain("Authors:");
    expect(result!.content).toContain("Abstract");
    expect(result!.source).toBe("arxiv");
  }, 15_000);

  it("handles arxiv PDF URLs too", async () => {
    const result = await arxivHandler.handle("https://arxiv.org/pdf/1706.03762");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Attention");
  }, 15_000);

  it("returns null for non-arxiv URL", async () => {
    const result = await arxivHandler.handle("https://example.com");
    expect(result).toBeNull();
  }, 5_000);

  it("extracts categories and dates", async () => {
    const result = await arxivHandler.handle("https://arxiv.org/abs/2301.00001");
    if (result) {
      expect(result.content).toContain("Published:");
      expect(result.content).toContain("arXiv:");
    }
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 8. YOUTUBE HANDLER — video metadata
// ═══════════════════════════════════════════════════════════════

describe("youtubeHandler (real network)", () => {
  it("extracts metadata for a well-known video", async () => {
    // Rick Astley — over 1B views, unlikely to be removed
    const result = await youtubeHandler.handle("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    if (result) {
      expect(result.source).toBe("youtube");
      expect(result.content).toContain("Rick");
      expect(result.content).toContain("Channel:");
      expect(result.content).toContain("Duration:");
      expect(result.content).toContain("Views:");
    }
  }, 15_000);

  it("handles youtu.be short URLs", async () => {
    const result = await youtubeHandler.handle("https://youtu.be/dQw4w9WgXcQ");
    if (result) {
      expect(result.source).toBe("youtube");
      expect(result.content).toContain("Rick");
    }
  }, 15_000);

  it("returns null for non-youtube URL", async () => {
    const result = await youtubeHandler.handle("https://example.com");
    expect(result).toBeNull();
  }, 5_000);
});

// ═══════════════════════════════════════════════════════════════
// 9. PDF HANDLER — PDF text extraction
// ═══════════════════════════════════════════════════════════════

describe("pdfHandler (real network)", () => {
  it("extracts text from a real PDF", async () => {
    // Public domain PDF
    const result = await pdfHandler.handle("https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("pdf");
  }, 30_000);

  it("returns fallback for non-PDF content fetched as PDF", async () => {
    // When called directly (not through router), pdfHandler tries to parse any URL as PDF.
    // For non-PDF content, pdf-parse fails and the handler returns a fallback message.
    const result = await pdfHandler.handle("https://example.com");
    if (result) {
      expect(result.content).toContain("Could not extract meaningful text");
      expect(result.source).toBe("pdf");
    }
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 10. TWITTER HANDLER — tweet extraction
// ═══════════════════════════════════════════════════════════════

describe("twitterHandler (real network)", () => {
  it("matches twitter.com URLs", () => {
    const matches = twitterHandler.patterns.some(p => p.test("https://twitter.com/elonmusk/status/1234567890"));
    expect(matches).toBe(true);
  });

  it("matches x.com URLs", () => {
    const matches = twitterHandler.patterns.some(p => p.test("https://x.com/elonmusk/status/1234567890"));
    expect(matches).toBe(true);
  });

  it("does not match non-tweet URLs", () => {
    const matches = twitterHandler.patterns.some(p => p.test("https://twitter.com/elonmusk"));
    expect(matches).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. ROUTER — handler routing with real handlers
// ═══════════════════════════════════════════════════════════════

describe("routeUrl with real handlers (real network)", () => {
  const handlers = [twitterHandler, youtubeHandler, arxivHandler, pdfHandler];

  it("routes arxiv URL to arxiv handler", async () => {
    const result = await routeUrl("https://arxiv.org/abs/1706.03762", handlers);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("arxiv");
  }, 15_000);

  it("returns null for a plain webpage", async () => {
    const result = await routeUrl("https://example.com", handlers);
    expect(result).toBeNull();
  }, 5_000);
});

// ═══════════════════════════════════════════════════════════════
// 12. PIPELINE — real multi-tier fallback
// ═══════════════════════════════════════════════════════════════

describe("runPipeline (real network)", () => {
  it("fetches example.com through the full pipeline", async () => {
    const fetchers: Fetcher[] = [jinaFetcher, rawFetcher, ogMetaFetcher];
    const result = await runPipeline("https://example.com", fetchers);
    expect(result.result.content).toContain("Example Domain");
    expect(result.result.quality).toBeGreaterThan(0);
    expect(result.attempts.length).toBeGreaterThan(0);
    expect(result.attempts.some(a => a.status === "success")).toBe(true);
  }, 20_000);

  it("falls back through tiers when tier 1 fails", async () => {
    // Create a tier 1 that always fails, then real tier 3
    const fakeTier1: Fetcher = { name: "fake-t1", tier: 1, fetch: async () => null };
    const fetchers: Fetcher[] = [fakeTier1, rawFetcher, ogMetaFetcher];
    const result = await runPipeline("https://example.com", fetchers);
    expect(result.result.source).not.toBe("fake-t1");
    expect(result.result.content.length).toBeGreaterThan(50);
    expect(result.attempts[0].status).toBe("failed");
  }, 20_000);

  it("respects maxTier option", async () => {
    const fetchers: Fetcher[] = [jinaFetcher, rawFetcher, ogMetaFetcher];
    const result = await runPipeline("https://example.com", fetchers, { maxTier: 1 });
    // Only tier 1 (jina) should be attempted
    const attemptedNames = result.attempts.map(a => a.name);
    expect(attemptedNames).not.toContain("raw"); // tier 3
    expect(attemptedNames).not.toContain("og-meta"); // tier 5
  }, 15_000);

  it("records timing on all attempts", async () => {
    const fetchers: Fetcher[] = [rawFetcher, ogMetaFetcher];
    const result = await runPipeline("https://example.com", fetchers);
    for (const attempt of result.attempts) {
      if (attempt.status === "success") {
        expect(attempt.timing).toBeGreaterThan(0);
      }
    }
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 13. HTML PROCESSING — real page extraction
// ═══════════════════════════════════════════════════════════════

describe("htmlToText with real HTML", () => {
  it("extracts text from a fetched page", async () => {
    const resp = await fetch("https://example.com");
    const html = await resp.text();
    const text = htmlToText(html);
    expect(text).toContain("Example Domain");
    expect(text.length).toBeGreaterThan(50);
  }, 15_000);

  it("handles Wikipedia HTML", async () => {
    const resp = await fetch("https://en.wikipedia.org/wiki/JavaScript");
    const html = await resp.text();
    const text = htmlToText(html);
    expect(text.length).toBeGreaterThan(1000);
  }, 15_000);
});

describe("extractMeta with real HTML", () => {
  it("extracts OG tags from GitHub", async () => {
    const resp = await fetch("https://github.com");
    const html = await resp.text();
    const meta = extractMeta(html);
    expect(meta.title.length).toBeGreaterThan(0);
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 14. QUALITY SCORING — real content scoring
// ═══════════════════════════════════════════════════════════════

describe("scoreContent with real fetched content", () => {
  it("scores Wikipedia content highly", async () => {
    const resp = await fetch("https://en.wikipedia.org/wiki/TypeScript");
    const html = await resp.text();
    const text = htmlToText(html);
    const score = scoreContent(text);
    expect(score).toBeGreaterThan(0.5);
  }, 15_000);

  it("scores example.com content as 0 (too short)", async () => {
    // example.com has very minimal content (<200 chars after extraction)
    // scoreContent correctly returns 0 for content below the minimum threshold
    const resp = await fetch("https://example.com");
    const html = await resp.text();
    const text = htmlToText(html);
    const score = scoreContent(text);
    expect(score).toBe(0);
  }, 15_000);

  it("scores empty string as 0", () => {
    expect(scoreContent("")).toBe(0);
  });

  it("scores short content as 0", () => {
    expect(scoreContent("too short")).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 15. URL NORMALIZATION — real-world URLs
// ═══════════════════════════════════════════════════════════════

describe("normalizeUrl with real-world patterns", () => {
  it("strips UTM params", () => {
    expect(normalizeUrl("https://example.com/page?utm_source=twitter&utm_medium=social"))
      .toBe("https://example.com/page");
  });

  it("strips Facebook click IDs", () => {
    expect(normalizeUrl("https://example.com/page?fbclid=abc123"))
      .toBe("https://example.com/page");
  });

  it("preserves functional params", () => {
    expect(normalizeUrl("https://example.com/page?page=2&limit=10"))
      .toBe("https://example.com/page?page=2&limit=10");
  });

  it("upgrades HTTP to HTTPS", () => {
    expect(normalizeUrl("http://example.com/page"))
      .toBe("https://example.com/page");
  });

  it("strips trailing slash", () => {
    expect(normalizeUrl("https://example.com/page/"))
      .toBe("https://example.com/page");
  });

  it("keeps root slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("strips multiple tracking params at once", () => {
    const url = "https://example.com/article?utm_source=email&utm_medium=newsletter&utm_campaign=weekly&gclid=xyz&ref=homepage";
    const normalized = normalizeUrl(url);
    expect(normalized).not.toContain("utm_");
    expect(normalized).not.toContain("gclid");
    expect(normalized).toContain("ref=homepage"); // ref is functional
  });

  it("normalizes YouTube URLs consistently", () => {
    const url1 = normalizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=share");
    const url2 = normalizeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&fbclid=abc");
    expect(url1).toBe(url2);
  });
});

// ═══════════════════════════════════════════════════════════════
// 16. CACHE — real integration with pipeline
// ═══════════════════════════════════════════════════════════════

describe("LRUCache with real pipeline results", () => {
  it("stores and retrieves a real pipeline result", async () => {
    const cache = new LRUCache(10);
    const fetchers: Fetcher[] = [rawFetcher, ogMetaFetcher];
    const result = await runPipeline("https://example.com", fetchers);
    cache.set("https://example.com", result);

    const cached = cache.get("https://example.com");
    expect(cached).not.toBeUndefined();
    expect(cached!.result.content).toBe(result.result.content);
    expect(cached!.result.source).toBe(result.result.source);
  }, 15_000);

  it("TTL expiry works with real data", async () => {
    const cache = new LRUCache(10, { ttl: 50 });
    const fetchers: Fetcher[] = [rawFetcher, ogMetaFetcher];
    const result = await runPipeline("https://example.com", fetchers);
    cache.set("https://example.com", result);

    expect(cache.get("https://example.com")).toBeDefined();
    await new Promise(r => setTimeout(r, 60));
    expect(cache.get("https://example.com")).toBeUndefined();
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 17. SEARXNG SEARCH — real search backend
// ═══════════════════════════════════════════════════════════════

describe("searxngSearch (real network)", () => {
  it("returns results for a common query", async () => {
    const result = await searxngSearch("typescript programming language", "https://search.sapti.me", 3);
    if (result) {
      expect(result.source).toBe("searxng");
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].title.length).toBeGreaterThan(0);
      expect(result.results[0].url.length).toBeGreaterThan(0);
      expect(result.timing).toBeGreaterThan(0);
    }
    // SearXNG public instance may be down — acceptable
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 18. FULL SERVER — fetch tool via MCP protocol (real URLs)
// ═══════════════════════════════════════════════════════════════

describe("fetch tool via MCP protocol (real network)", () => {
  it("fetches example.com end-to-end", async () => {
    const result = await client.callTool({
      name: "fetch",
      arguments: { url: "https://example.com" },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("Example Domain");
    expect(text).toContain("source:");
    expect(text).toContain("quality:");
  }, 30_000);

  it("fetches an arxiv paper end-to-end", async () => {
    const result = await client.callTool({
      name: "fetch",
      arguments: { url: "https://arxiv.org/abs/1706.03762" },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain("Attention");
  }, 30_000);

  it("fetches Wikipedia end-to-end", async () => {
    const result = await client.callTool({
      name: "fetch",
      arguments: { url: "https://en.wikipedia.org/wiki/Rust_(programming_language)" },
    });
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text.length).toBeGreaterThan(500);
  }, 30_000);

  it("returns cached result on second fetch of same URL", async () => {
    const url = "https://httpbin.org/html";
    const r1 = await client.callTool({ name: "fetch", arguments: { url } });
    const r2 = await client.callTool({ name: "fetch", arguments: { url } });
    const text2 = getText(r2);
    expect(text2).toContain("cache (");
  }, 30_000);

  it("caches across URL normalization (strips utm params)", async () => {
    const url1 = "https://example.com?utm_source=test1";
    const url2 = "https://example.com?utm_source=test2";
    await client.callTool({ name: "fetch", arguments: { url: url1 } });
    const r2 = await client.callTool({ name: "fetch", arguments: { url: url2 } });
    const text2 = getText(r2);
    expect(text2).toContain("cache (");
  }, 30_000);

  it("respects maxTier parameter", async () => {
    const result = await client.callTool({
      name: "fetch",
      arguments: { url: "https://en.wikipedia.org/wiki/Python_(programming_language)", maxTier: 1 },
    });
    const text = getText(result);
    // Should only have tried tier 1 (jina)
    expect(text).not.toContain("raw: success");
    expect(text).not.toContain("og-meta: success");
  }, 30_000);

  it("includes timing metadata in response", async () => {
    const result = await client.callTool({
      name: "fetch",
      arguments: { url: "https://httpbin.org/get" },
    });
    const text = getText(result);
    expect(text).toContain("time:");
    expect(text).toContain("attempts:");
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════
// 19. FULL SERVER — search tool via MCP protocol
// ═══════════════════════════════════════════════════════════════

describe("search tool via MCP protocol (real network)", () => {
  it("searches via SearXNG and returns results", async () => {
    // No BRAVE_API_KEY in test env, so falls back to SearXNG
    const result = await client.callTool({
      name: "search",
      arguments: { query: "TypeScript programming", count: 3 },
    });

    if (result.isError) {
      // SearXNG might be down — check error message is instructional
      const text = getText(result);
      expect(text).toContain("BRAVE_API_KEY");
      return;
    }

    // Success path: structured content
    expect(result.structuredContent).toBeDefined();
    const structured = result.structuredContent as {
      results: Array<{ title: string; url: string; snippet: string }>;
      source: string;
      timing: number;
    };
    expect(structured.results.length).toBeGreaterThan(0);
    expect(structured.source).toBe("searxng");

    // Also has markdown text content
    const text = getText(result);
    expect(text).toContain("Search:");
  }, 20_000);

  it("returns structuredContent with proper types", async () => {
    const result = await client.callTool({
      name: "search",
      arguments: { query: "JavaScript MDN", count: 2 },
    });

    if (!result.isError && result.structuredContent) {
      const s = result.structuredContent as Record<string, unknown>;
      expect(Array.isArray(s.results)).toBe(true);
      expect(typeof s.source).toBe("string");
      expect(typeof s.timing).toBe("number");

      const results = s.results as Array<Record<string, unknown>>;
      for (const r of results) {
        expect(typeof r.title).toBe("string");
        expect(typeof r.url).toBe("string");
        expect(typeof r.snippet).toBe("string");
      }
    }
  }, 20_000);
});

// ═══════════════════════════════════════════════════════════════
// 20. FULL SERVER — prompts via MCP protocol
// ═══════════════════════════════════════════════════════════════

describe("prompts via MCP protocol (real server)", () => {
  it("lists all prompts with metadata", async () => {
    const result = await client.listPrompts();
    expect(result.prompts.length).toBe(2);
    for (const p of result.prompts) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.title!.length).toBeGreaterThan(0);
      expect(p.description!.length).toBeGreaterThan(0);
      expect(p.arguments!.length).toBeGreaterThan(0);
    }
  });

  it("research-topic generates valid prompt with arguments", async () => {
    const result = await client.getPrompt({
      name: "research-topic",
      arguments: { topic: "WebAssembly", depth: "5" },
    });
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].role).toBe("user");
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).toContain("WebAssembly");
    expect(text).toContain("5");
    expect(text).toContain("Search for");
    expect(text).toContain("fetch the top");
  });

  it("extract-article generates valid prompt with URL", async () => {
    const result = await client.getPrompt({
      name: "extract-article",
      arguments: { url: "https://example.com/article" },
    });
    expect(result.messages.length).toBe(1);
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).toContain("https://example.com/article");
    expect(text).toContain("Fetch the content");
    expect(text).toContain("extract the key points");
  });

  it("research-topic uses default depth of 3", async () => {
    const result = await client.getPrompt({
      name: "research-topic",
      arguments: { topic: "GraphQL" },
    });
    const text = (result.messages[0].content as { text: string }).text;
    expect(text).toContain("3");
  });
});

// ═══════════════════════════════════════════════════════════════
// 21. FULL SERVER — tool listing verification
// ═══════════════════════════════════════════════════════════════

describe("tool listing via MCP protocol (real server)", () => {
  it("returns exactly 2 tools", async () => {
    const result = await client.listTools();
    expect(result.tools.length).toBe(2);
  });

  it("fetch tool has all required fields", async () => {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === "fetch")!;
    expect(tool.title).toBe("Fetch URL");
    expect(tool.description!.length).toBeGreaterThan(50);
    expect(tool.inputSchema.properties).toHaveProperty("url");
    expect(tool.inputSchema.properties).toHaveProperty("maxTier");
    expect(tool.annotations!.readOnlyHint).toBe(true);
    expect(tool.annotations!.destructiveHint).toBe(false);
  });

  it("search tool has all required fields including outputSchema", async () => {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === "search")!;
    expect(tool.title).toBe("Web Search");
    expect(tool.inputSchema.properties).toHaveProperty("query");
    expect(tool.inputSchema.properties).toHaveProperty("count");
    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema!.properties).toHaveProperty("results");
    expect(tool.annotations!.readOnlyHint).toBe(true);
    expect(tool.annotations!.idempotentHint).toBe(false);
  });

  it("no tool description mentions outdated pricing", async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.description).not.toContain("free tier");
      expect(tool.description).not.toContain("2,000 queries");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 22. RAW FETCHER — more real sites
// ═══════════════════════════════════════════════════════════════

describe("rawFetcher additional sites (real network)", () => {
  it("fetches a GitHub repo page", async () => {
    const result = await rawFetcher.fetch("https://github.com/nodejs/node");
    if (result) {
      expect(result.content.length).toBeGreaterThan(200);
      expect(result.quality).toBeGreaterThan(0);
    }
  }, 15_000);

  it("fetches MDN docs", async () => {
    const result = await rawFetcher.fetch("https://developer.mozilla.org/en-US/docs/Web/JavaScript");
    if (result) {
      expect(result.content.length).toBeGreaterThan(200);
      expect(result.source).toBe("raw");
    }
  }, 15_000);

  it("fetches a news site", async () => {
    const result = await rawFetcher.fetch("https://www.bbc.com/news");
    if (result) {
      expect(result.content.length).toBeGreaterThan(100);
    }
  }, 15_000);

  it("handles redirect correctly", async () => {
    // httpbin.org/redirect/1 redirects to /get
    const result = await rawFetcher.fetch("https://httpbin.org/redirect/1");
    if (result) {
      expect(result.content.length).toBeGreaterThan(0);
    }
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 23. SEMANTIC SCHOLAR FETCHER — real API
// ═══════════════════════════════════════════════════════════════

describe("semanticScholarFetcher (real network)", () => {
  it("returns null for non-academic URL", async () => {
    const result = await semanticScholarFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  }, 15_000);

  it("finds a well-known paper by URL", async () => {
    const result = await semanticScholarFetcher.fetch("https://arxiv.org/abs/1706.03762");
    if (result) {
      expect(result.source).toBe("semantic-scholar");
      expect(result.content).toContain("Attention");
    }
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 24. CODETABS FETCHER — CORS proxy
// ═══════════════════════════════════════════════════════════════

describe("codetabsFetcher (real network)", () => {
  it("fetches example.com via CORS proxy", async () => {
    const result = await codetabsFetcher.fetch("https://example.com");
    if (result) {
      expect(result.source).toBe("codetabs");
      expect(result.content.length).toBeGreaterThan(0);
    }
    // Codetabs may be rate-limited or down
  }, 15_000);
});

// ═══════════════════════════════════════════════════════════════
// 25. QUALITY SCORING — edge cases with real content
// ═══════════════════════════════════════════════════════════════

describe("scoreContent edge cases", () => {
  it("content with exactly 200 chars scores > 0", () => {
    const content = "a".repeat(200);
    expect(scoreContent(content)).toBeGreaterThan(0);
  });

  it("content with 199 chars scores 0", () => {
    const content = "a".repeat(199);
    expect(scoreContent(content)).toBe(0);
  });

  it("content with CAPTCHA in header scores 0", () => {
    const content = "Please complete the CAPTCHA to continue" + "x".repeat(300);
    expect(scoreContent(content)).toBe(0);
  });

  it("content mentioning CAPTCHA after 500 chars is not penalized", () => {
    const content = "x".repeat(501) + " captcha discussion";
    expect(scoreContent(content)).toBeGreaterThan(0);
  });

  it("content with Cloudflare challenge scores 0", () => {
    const content = "Checking your browser cf-challenge" + "x".repeat(300);
    expect(scoreContent(content)).toBe(0);
  });

  it("content with login wall scores 0", () => {
    const content = "Please sign in to continue reading this article" + "x".repeat(300);
    expect(scoreContent(content)).toBe(0);
  });

  it("long high-quality content scores near 1.0", () => {
    const content = "This is a very long article about programming. ".repeat(200);
    const score = scoreContent(content);
    expect(score).toBeGreaterThan(0.7);
  });

  it("content with high link ratio is penalized", () => {
    const links = "[link](http://example.com) ".repeat(50);
    const text = "Some words here. " + links;
    const score = scoreContent(text);
    const pureScore = scoreContent("Some words here. ".repeat(50));
    expect(score).toBeLessThan(pureScore);
  });
});

// ═══════════════════════════════════════════════════════════════
// 26. URL NORMALIZATION — more patterns
// ═══════════════════════════════════════════════════════════════

describe("normalizeUrl additional patterns", () => {
  it("strips Google click IDs", () => {
    expect(normalizeUrl("https://example.com?gclid=abc123")).toBe("https://example.com/");
  });

  it("strips Microsoft click IDs", () => {
    expect(normalizeUrl("https://example.com?msclkid=abc123")).toBe("https://example.com/");
  });

  it("strips _ga analytics param", () => {
    const result = normalizeUrl("https://example.com?_ga=2.123456789");
    expect(result).not.toContain("_ga");
  });

  it("handles URLs with hash fragments", () => {
    const result = normalizeUrl("https://example.com/page#section");
    expect(result).not.toContain("#");
  });

  it("handles complex URLs with mix of tracking and functional params", () => {
    const url = "https://example.com/search?q=test&page=2&utm_source=google&limit=10&fbclid=abc";
    const result = normalizeUrl(url);
    expect(result).toContain("q=test");
    expect(result).toContain("page=2");
    expect(result).toContain("limit=10");
    expect(result).not.toContain("utm_source");
    expect(result).not.toContain("fbclid");
  });

  it("normalizes identical URLs with different tracking params to same result", () => {
    const url1 = normalizeUrl("https://example.com/article?utm_source=twitter");
    const url2 = normalizeUrl("https://example.com/article?utm_source=facebook");
    const url3 = normalizeUrl("https://example.com/article?fbclid=abc");
    expect(url1).toBe(url2);
    expect(url2).toBe(url3);
  });
});

// ═══════════════════════════════════════════════════════════════
// 27. FULL SERVER — fetch diverse URL types end-to-end
// ═══════════════════════════════════════════════════════════════

describe("fetch tool diverse URLs (real network)", () => {
  it("fetches a JSON API endpoint", async () => {
    const result = await client.callTool({
      name: "fetch",
      arguments: { url: "https://httpbin.org/json" },
    });
    const text = getText(result);
    expect(text.length).toBeGreaterThan(0);
  }, 30_000);

  it("fetches a YouTube video and gets metadata", async () => {
    const result = await client.callTool({
      name: "fetch",
      arguments: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    });
    if (!result.isError) {
      const text = getText(result);
      expect(text).toContain("Rick");
      expect(text).toContain("source: youtube");
    }
  }, 30_000);

  it("fetches GitHub README content", async () => {
    const result = await client.callTool({
      name: "fetch",
      arguments: { url: "https://github.com/nodejs/node" },
    });
    const text = getText(result);
    expect(text.length).toBeGreaterThan(100);
  }, 30_000);

  it("handles URL with tracking params (strips them)", async () => {
    const result = await client.callTool({
      name: "fetch",
      arguments: { url: "https://example.com?utm_source=e2e_test&utm_medium=test" },
    });
    expect(result.isError).toBeFalsy();
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════
// 28. HTML EXTRACTION — edge cases with real HTML
// ═══════════════════════════════════════════════════════════════

describe("htmlToText edge cases", () => {
  it("handles empty string", () => {
    expect(htmlToText("")).toBe("");
  });

  it("handles plain text (no HTML tags)", () => {
    const text = htmlToText("Just some plain text without any HTML tags at all.");
    expect(text).toContain("Just some plain text");
  });

  it("strips script and style tags", () => {
    const html = `<html><head><style>body { color: red; }</style></head><body><script>alert('xss')</script><p>Safe content</p></body></html>`;
    const text = htmlToText(html);
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color: red");
    expect(text).toContain("Safe content");
  });

  it("handles entities", () => {
    const html = `<p>Tom &amp; Jerry &lt;3 each other &quot;always&quot;</p>`;
    const text = htmlToText(html);
    expect(text).toContain("Tom & Jerry");
    expect(text).toContain("<3");
  });
});

// ═══════════════════════════════════════════════════════════════
// 29. EXTRACTMETA — real-world meta tag patterns
// ═══════════════════════════════════════════════════════════════

describe("extractMeta patterns", () => {
  it("extracts all fields from well-formed HTML", () => {
    const html = `<html><head>
      <title>Test Page</title>
      <meta property="og:title" content="OG Title" />
      <meta property="og:description" content="OG Desc" />
      <meta property="og:image" content="https://example.com/img.jpg" />
      <meta name="description" content="Meta desc" />
      <meta property="article:author" content="Jane" />
      <meta property="article:published_time" content="2025-01-01" />
    </head></html>`;
    const meta = extractMeta(html);
    expect(meta.title).toBe("Test Page");
    expect(meta.ogTitle).toBe("OG Title");
    expect(meta.ogDescription).toBe("OG Desc");
    expect(meta.ogImage).toBe("https://example.com/img.jpg");
    expect(meta.description).toBe("Meta desc");
    expect(meta.author).toBe("Jane");
    expect(meta.publishedTime).toBe("2025-01-01");
  });

  it("handles missing meta tags gracefully", () => {
    const html = `<html><head><title>Minimal</title></head></html>`;
    const meta = extractMeta(html);
    expect(meta.title).toBe("Minimal");
    expect(meta.ogTitle).toBe("");
    expect(meta.ogDescription).toBe("");
    expect(meta.author).toBe("");
  });

  it("handles empty HTML", () => {
    const meta = extractMeta("");
    expect(meta.title).toBe("");
    expect(meta.ogTitle).toBe("");
  });
});
