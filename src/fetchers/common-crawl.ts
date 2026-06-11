import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { htmlToMarkdown } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

/**
 * Common Crawl fetcher — recovers a page from Common Crawl's petabyte web
 * archive. Unlike origin-facing fetchers it reads from Common Crawl's index
 * API and S3 (data.commoncrawl.org), so it isn't subject to the origin's
 * rate limits, bot detection, or paywall. Free and effectively unblockable.
 *
 * Flow: resolve the latest crawl's CDX endpoint -> look up the URL to get a
 * WARC {filename, offset, length} -> HTTP range-GET that single gzip-
 * compressed WARC record -> gunzip -> split WARC/HTTP headers from the body.
 */

const COLLINFO_URL = "https://index.commoncrawl.org/collinfo.json";
const DATA_BASE = "https://data.commoncrawl.org/";
const INDEX_TTL_MS = 24 * 60 * 60_000;

interface CdxApiInfo {
  id: string;
  "cdx-api": string;
}

interface CdxRecord {
  url: string;
  mime: string;
  status: string;
  filename: string;
  offset: string;
  length: string;
}

let cachedCdxApi: { url: string; at: number } | null = null;

/** Test seam: clear the memoized crawl index between cases. */
export function resetIndexCacheForTests(): void {
  cachedCdxApi = null;
}

async function latestCdxApi(): Promise<string | null> {
  if (cachedCdxApi && Date.now() - cachedCdxApi.at < INDEX_TTL_MS) return cachedCdxApi.url;
  try {
    const response = await fetchWithTimeout(COLLINFO_URL, { headers: { Accept: "application/json" } }, 8_000);
    if (!response.ok) return null;
    const collections = (await response.json()) as CdxApiInfo[];
    const api = collections?.[0]?.["cdx-api"];
    if (!api) return null;
    cachedCdxApi = { url: api, at: Date.now() };
    return api;
  } catch {
    return null;
  }
}

async function lookupRecord(cdxApi: string, url: string): Promise<CdxRecord | null> {
  try {
    const query = `${cdxApi}?url=${encodeURIComponent(url)}&output=json&limit=5&filter=status:200`;
    const response = await fetchWithTimeout(query, { headers: { Accept: "application/json" } }, 8_000);
    if (!response.ok) return null;
    const body = (await response.text()).trim();
    if (!body) return null;

    const records: CdxRecord[] = [];
    for (const line of body.split("\n")) {
      try {
        records.push(JSON.parse(line) as CdxRecord);
      } catch {
        /* skip non-JSON lines */
      }
    }
    // CDX returns ascending by capture time; prefer the most recent HTML 200.
    const html = records.filter((r) => r.status === "200" && /html/i.test(r.mime ?? ""));
    const pool = html.length ? html : records.filter((r) => r.status === "200");
    return pool.length ? pool[pool.length - 1] : null;
  } catch {
    return null;
  }
}

function isGzip(buf: Uint8Array): boolean {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

async function gunzip(buf: Uint8Array): Promise<Uint8Array> {
  const { gunzipSync } = await import("node:zlib");
  return gunzipSync(buf);
}

/**
 * A WARC response record is: WARC headers, blank line, HTTP headers, blank
 * line, then the response body. Return the body (gunzipped if the origin
 * served it gzip-encoded).
 */
async function extractWarcBody(record: Uint8Array): Promise<string | null> {
  const buf = Buffer.from(record);
  const sep = Buffer.from("\r\n\r\n");

  const warcEnd = buf.indexOf(sep);
  if (warcEnd === -1) return null;
  const httpStart = warcEnd + sep.length;
  const httpEnd = buf.indexOf(sep, httpStart);
  if (httpEnd === -1) return null;

  const httpHeaders = buf.slice(httpStart, httpEnd).toString("latin1");
  let body: Uint8Array = buf.slice(httpEnd + sep.length);

  if (/content-encoding:\s*gzip/i.test(httpHeaders) && isGzip(body)) {
    try {
      body = await gunzip(body);
    } catch {
      /* leave as-is */
    }
  }

  const text = Buffer.from(body).toString("utf-8");
  return text.length ? text : null;
}

export const commonCrawlFetcher: Fetcher = {
  name: "common-crawl",
  tier: 2,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      const cdxApi = await latestCdxApi();
      if (!cdxApi) return null;

      const record = await lookupRecord(cdxApi, url);
      if (!record) return null;

      const offset = Number(record.offset);
      const length = Number(record.length);
      if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0) return null;

      const response = await fetchWithTimeout(
        `${DATA_BASE}${record.filename}`,
        { headers: { Range: `bytes=${offset}-${offset + length - 1}` } },
        10_000,
      );
      if (!response.ok) return null;

      const raw = new Uint8Array(await response.arrayBuffer());
      const decompressed = isGzip(raw) ? await gunzip(raw) : raw;

      const html = await extractWarcBody(decompressed);
      if (!html) return null;

      const content = htmlToMarkdown(html);
      const quality = scoreContent(content);
      if (quality < 0.1) return null;

      return { content, source: "common-crawl", quality, timing: Date.now() - start };
    } catch {
      return null;
    }
  },
};
