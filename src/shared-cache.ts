import { fetchWithTimeout } from "./fetch-with-timeout.js";
import type { FetchResult } from "./types.js";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_URL = "https://agentsweb.org";
const TIMEOUT = 5_000;

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
}

/**
 * Read from the shared agentsweb.org cache.
 * Returns a FetchResult if cache hit, null if miss.
 */
export async function sharedCacheRead(url: string): Promise<FetchResult | null> {
  const start = Date.now();
  try {
    const response = await fetchWithTimeout(
      `${CACHE_URL}/?url=${encodeURIComponent(url)}`,
      {},
      TIMEOUT
    );

    if (!response.ok) return null;

    const data = (await response.json()) as SharedCacheResponse;
    if (!data.markdown) return null;

    return {
      content: data.markdown,
      source: `agentsweb (trust:${data.trust_level}, via:${data.source})`,
      quality: Math.min(1, 0.5 + data.trust_level * 0.1), // trust 1 = 0.6, trust 5 = 1.0
      timing: Date.now() - start,
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
  ).catch(() => {}); // swallow errors — best effort
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
    ).catch(() => {});
  } catch {}
}
