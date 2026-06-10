import { describe, it, expect, vi, beforeEach } from "vitest";
import { gzipSync } from "node:zlib";
import { commonCrawlFetcher, resetIndexCacheForTests } from "../../fetchers/common-crawl.js";

const COLLINFO = JSON.stringify([
  { id: "CC-MAIN-2026-10", "cdx-api": "https://index.commoncrawl.org/CC-MAIN-2026-10-index" },
  { id: "CC-MAIN-2026-05", "cdx-api": "https://index.commoncrawl.org/CC-MAIN-2026-05-index" },
]);

const ARTICLE_HTML = `<html><body><article><h1>Archived Article</h1><p>${"This is the archived body content recovered from Common Crawl. ".repeat(8)}</p></article></body></html>`;

function warcRecord(html: string, httpHeaders = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n"): Buffer {
  const warc = "WARC/1.0\r\nWARC-Type: response\r\nWARC-Target-URI: https://example.com/article\r\n";
  return Buffer.from(`${warc}\r\n${httpHeaders}\r\n${html}`, "utf-8");
}

function cdxLine(overrides: Record<string, string> = {}): string {
  return JSON.stringify({
    url: "https://example.com/article",
    mime: "text/html",
    status: "200",
    filename: "crawl-data/CC-MAIN-2026-10/segments/x/warc/foo.warc.gz",
    offset: "0",
    length: "0", // set per-test to the gzipped record length
    ...overrides,
  });
}

describe("commonCrawlFetcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetIndexCacheForTests();
  });

  it("has the expected name and tier", () => {
    expect(commonCrawlFetcher.name).toBe("common-crawl");
    expect(commonCrawlFetcher.tier).toBe(2);
  });

  it("resolves index, looks up the record, and parses the WARC body", async () => {
    const gz = gzipSync(warcRecord(ARTICLE_HTML));

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const u = String(input);
      if (u === "https://index.commoncrawl.org/collinfo.json") {
        return Promise.resolve(new Response(COLLINFO, { status: 200 }));
      }
      if (u.startsWith("https://index.commoncrawl.org/CC-MAIN-2026-10-index")) {
        return Promise.resolve(new Response(cdxLine({ length: String(gz.length) }), { status: 200 }));
      }
      if (u.startsWith("https://data.commoncrawl.org/")) {
        expect((init?.headers as Record<string, string>).Range).toBe(`bytes=0-${gz.length - 1}`);
        return Promise.resolve(new Response(gz, { status: 206 }));
      }
      return Promise.resolve(new Response("unexpected", { status: 404 }));
    });

    const result = await commonCrawlFetcher.fetch("https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("common-crawl");
    expect(result!.content).toContain("Archived Article");
    expect(result!.content).toContain("recovered from Common Crawl");
    expect(result!.quality).toBeGreaterThan(0.1);
  });

  it("gunzips a gzip-encoded HTTP body inside the record", async () => {
    const innerGz = gzipSync(Buffer.from(ARTICLE_HTML, "utf-8"));
    const record = Buffer.concat([
      Buffer.from("WARC/1.0\r\nWARC-Type: response\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Encoding: gzip\r\n\r\n", "utf-8"),
      innerGz,
    ]);
    const gz = gzipSync(record);

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const u = String(input);
      if (u.endsWith("collinfo.json")) return Promise.resolve(new Response(COLLINFO, { status: 200 }));
      if (u.includes("-index")) return Promise.resolve(new Response(cdxLine({ length: String(gz.length) }), { status: 200 }));
      return Promise.resolve(new Response(gz, { status: 206 }));
    });

    const result = await commonCrawlFetcher.fetch("https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Archived Article");
  });

  it("returns null when the URL is not in the index", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const u = String(input);
      if (u.endsWith("collinfo.json")) return Promise.resolve(new Response(COLLINFO, { status: 200 }));
      if (u.includes("-index")) return Promise.resolve(new Response("", { status: 200 }));
      return Promise.resolve(new Response("nope", { status: 404 }));
    });

    const result = await commonCrawlFetcher.fetch("https://example.com/missing");
    expect(result).toBeNull();
  });

  it("returns null when collinfo is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("down", { status: 503 }));
    const result = await commonCrawlFetcher.fetch("https://example.com/article");
    expect(result).toBeNull();
  });

  it("memoizes the crawl index across calls", async () => {
    const gz = gzipSync(warcRecord(ARTICLE_HTML));
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const u = String(input);
      if (u.endsWith("collinfo.json")) return Promise.resolve(new Response(COLLINFO, { status: 200 }));
      if (u.includes("-index")) return Promise.resolve(new Response(cdxLine({ length: String(gz.length) }), { status: 200 }));
      return Promise.resolve(new Response(gz, { status: 206 }));
    });

    await commonCrawlFetcher.fetch("https://example.com/article");
    await commonCrawlFetcher.fetch("https://example.com/article");

    const collinfoCalls = spy.mock.calls.filter((c) => String(c[0]).endsWith("collinfo.json"));
    expect(collinfoCalls).toHaveLength(1);
  });
});
