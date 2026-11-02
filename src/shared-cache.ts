import { fetchWithTimeout } from "./fetch-with-timeout.js";
import type { FetchResult } from "./types.js";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { scoreContent } from "./quality.js";
import { normalizeUrl } from "./normalize.js";

const CACHE_URL = "https://agentsweb.org";
const TIMEOUT = 2_500;
const INDIRECT_CACHE_SOURCES = new Set([
  "crossref",
  "hackernews",
  "og-meta",
  "reddit",
  "semantic-scholar",
]);

// Persistent instance ID (anonymous, survives restarts)
let instanceId: string | null = null;

function getInstanceId(): string {
  if (instanceId) return instanceId;

  const dir = join(homedir(), ".intercept-mcp");
  const file = join(dir, "instance-id");

  try {
    instanceId = readFileSync(file, "utf-8").trim();
    if (/^[a-zA-Z0-9]{16,64}$/.test(instanceId)) return instanceId;
  } catch {}

  instanceId = randomBytes(16).toString("hex");
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, instanceId);
  } catch {}

  return instanceId;
}

interface SharedCacheResponse {
  url: string;
  markdown: string;
  trust_level: number;
  source: string;
  age_seconds: number;
  truncated?: boolean;
  completeness?: string;
  source_kind?: string;
  retrieved_at?: string;
  verified_at?: string | null;
  content_hash?: string;
  archived_at?: string;
}

function isIndirectCacheSource(source: string): boolean {
  return INDIRECT_CACHE_SOURCES.has(source.trim().toLowerCase());
}

/**
 * Read from the shared agentsweb.org cache.
 * Returns a FetchResult if cache hit, null if miss.
 */
export async function sharedCacheRead(url: string, options: { maxAgeSeconds?: number; allowArchive?: boolean } = {}): Promise<FetchResult | null> {
  const start = Date.now();
  try {
    const response = await fetchWithTimeout(
      `${CACHE_URL}/?url=${encodeURIComponent(url)}&clean=false&max_age=${options.maxAgeSeconds ?? 3600}`,
      {},
      TIMEOUT
    );

    if (!response.ok) return null;

    const data = (await response.json()) as SharedCacheResponse;
    if (typeof data.markdown !== "string" || data.markdown.length < 200 || data.markdown.length > 5_000_000) return null;
    if (typeof data.source !== "string" || typeof data.url !== "string" || normalizeUrl(data.url) !== normalizeUrl(url)) return null;
    if (data.truncated || (data.completeness && data.completeness !== "complete")) return null;
    const actualHash = createHash('sha256').update(data.markdown).digest('hex');
    if (data.content_hash && data.content_hash !== actualHash) return null;
    if (data.retrieved_at && (!Number.isFinite(Date.parse(data.retrieved_at)) || Date.parse(data.retrieved_at) > Date.now()+60_000)) return null;
    if (typeof data.age_seconds !== "number" || !Number.isFinite(data.age_seconds) || data.age_seconds < 0 || data.age_seconds > (options.maxAgeSeconds ?? 3600)) return null;
    const archive = data.source_kind === "archive" || /wayback|arquivo|archive-ph|common-crawl/.test(data.source);
    if (archive && options.allowArchive === false) return null;
    if (isIndirectCacheSource(data.source)) return null;
    const quality = scoreContent(data.markdown);
    if (quality < 0.3) return null;

    return {
      content: data.markdown,
      source: `agentsweb (trust:${data.trust_level}, via:${data.source})`,
      quality,
      timing: Date.now() - start,
      ageSeconds: typeof data.age_seconds === "number" ? data.age_seconds : undefined,
      completeness: "complete",
      sourceKind: archive ? "archive" : "live",
      retrievedAt: data.retrieved_at ?? new Date(Date.now() - data.age_seconds * 1000).toISOString(),
      verifiedAt: typeof data.verified_at === "string" ? data.verified_at : undefined,
      canonicalUrl: data.url,
      contentHash: actualHash,
      archivedAt: data.archived_at,
    };
  } catch {
    return null;
  }
}

/**
 * Contribute a fetch result to the shared cache.
 * Fire-and-forget — doesn't block the response to the agent.
 */
export function sharedCacheWrite(url: string, markdown: string, source: string): void {
  const body = JSON.stringify({
    url,
    markdown,
    source,
    instance_id: getInstanceId(),
  });

  fetchWithTimeout(
    `${CACHE_URL}/`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    },
    TIMEOUT
  ).then(response => response.body?.cancel()).catch(() => {}); // best effort
}

/**
 * Confirm that a cached entry matches our local fetch.
 * Fire-and-forget.
 */
export async function sharedCacheConfirm(url: string, markdown: string): Promise<void> {
  try {
    const data = new TextEncoder().encode(markdown);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    fetchWithTimeout(
      `${CACHE_URL}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          content_hash: contentHash,
          instance_id: getInstanceId(),
        }),
      },
      TIMEOUT
    ).then(response => response.body?.cancel()).catch(() => {});
  } catch {}
}
