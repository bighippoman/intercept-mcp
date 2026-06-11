import { authHeadersFor } from "./auth.js";

const DEFAULT_TIMEOUT = 10_000;

// HTTP statuses that typically mean "this egress IP is blocked" — worth
// retrying through a different proxy rather than giving up.
const BLOCK_STATUSES = new Set([403, 429, 451, 503]);
const MAX_ROTATION_ATTEMPTS = 3;

type FetchInit = RequestInit & { dispatcher?: unknown };
// If any standard proxy env var is set, route all fetch() through it.
// EnvHttpProxyAgent honors HTTPS_PROXY / HTTP_PROXY / NO_PROXY (and lowercase).
// Dynamic import avoids undici overriding the global fetch (which breaks
// decompression in undici >=7.27).
//
// INTERCEPT_PROXIES (a comma/space-separated list) takes precedence and enables
// per-request rotation: requests round-robin across the proxies and a blocked
// response (or network error) is retried through the next one. It uses a
// per-request undici dispatcher, so it overrides the global agent above.
if (
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  process.env.ALL_PROXY ||
  process.env.all_proxy
) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

let proxyList: string[] | null = null;
let rotationIndex = 0;
const agentCache = new Map<string, unknown>();

function isValidProxyUrl(u: string): boolean {
  try {
    const { protocol } = new URL(u);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function loadProxyList(): string[] {
  if (proxyList) return proxyList;
  const raw = process.env.INTERCEPT_PROXIES ?? "";
  proxyList = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(isValidProxyUrl);
  return proxyList;
}

/** Next proxy in round-robin order, or null when no rotation list is set. */
function nextProxy(): string | null {
  const list = loadProxyList();
  if (list.length === 0) return null;
  const proxy = list[rotationIndex % list.length];
  rotationIndex++;
  return proxy;
}

async function agentFor(proxyUrl: string): Promise<unknown> {
  const cached = agentCache.get(proxyUrl);
  if (cached) return cached;
  const { ProxyAgent } = await import("undici");
  const agent = new ProxyAgent(proxyUrl);
  agentCache.set(proxyUrl, agent);
  return agent;
}

/** Reset rotation state between tests. */
export function __resetProxyStateForTests(): void {
  proxyList = null;
  rotationIndex = 0;
  agentCache.clear();
}

export function getProxyUrl(): string | undefined {
  // Rotation list wins; otherwise fall back to the standard single proxy var.
  return (
    nextProxy() ??
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy ??
    process.env.ALL_PROXY ??
    process.env.all_proxy ??
    undefined
  );
}

/**
 * Attach per-domain auth headers for `url`'s host. Keyed on the actual host
 * contacted, so credentials never leak to proxies/archives/Jina. Existing
 * caller headers win on conflict (e.g. a handler's own Authorization).
 */
function withAuth(url: string, init: RequestInit): RequestInit {
  const auth = authHeadersFor(url);
  if (Object.keys(auth).length === 0) return init;
  const headers = new Headers(init.headers as HeadersInit | undefined);
  for (const [name, value] of Object.entries(auth)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return { ...init, headers };
}

async function timedFetch(url: string, init: FetchInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal } as RequestInit);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = DEFAULT_TIMEOUT,
): Promise<Response> {
  init = withAuth(url, init);

  const list = loadProxyList();
  if (list.length === 0) {
    // No rotation configured — behave exactly as before (global agent applies
    // if a standard proxy env var was set).
    return timedFetch(url, init, ms);
  }

  // Rotate across proxies, retrying on a network error or a block-ish status.
  const attempts = Math.min(list.length, MAX_ROTATION_ATTEMPTS);
  let lastResponse: Response | null = null;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    const proxyUrl = list[rotationIndex % list.length];
    rotationIndex++;
    try {
      const dispatcher = await agentFor(proxyUrl);
      const response = await timedFetch(url, { ...init, dispatcher }, ms);
      // Accept anything that isn't a block, and always accept the last try.
      if (!BLOCK_STATUSES.has(response.status) || i === attempts - 1) return response;
      lastResponse = response; // blocked — rotate to the next proxy
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error("all proxies failed");
}
