import { authHeadersFor } from "./auth.js";
import { requestSignal } from "./request-context.js";
import { blockedUrlReason } from "./url-guard.js";

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
  const signals = [AbortSignal.timeout(ms), init.signal, requestSignal()].filter((s): s is AbortSignal => !!s);
  const signal = AbortSignal.any(signals);
  signal.throwIfAborted();
  let target = url;
  let headers = new Headers(init.headers);
  for (let redirects = 0; redirects <= 8; redirects++) {
    const response = await fetch(target, { ...withAuth(target, { ...init, headers }), signal, redirect: "manual" } as RequestInit);
    if (response.status >= 300 && response.status < 400 && response.headers.has("location") && init.redirect !== "manual") {
      await response.body?.cancel();
      if (init.redirect === "error") throw new Error("Redirects are disabled for this request");
      if (redirects === 8) throw new Error("Too many redirects");
      const next = new URL(response.headers.get("location")!, target).href;
      const blocked = blockedUrlReason(next);
      if (blocked) throw new Error(`Redirect refused: ${blocked}`);
      if (new URL(next).origin !== new URL(target).origin) {
        const safe = new Headers();
        for (const name of ["accept", "accept-language", "user-agent"]) {
          const value = headers.get(name);
          if (value) safe.set(name, value);
        }
        headers = safe;
        if (init.method && !["GET", "HEAD"].includes(init.method.toUpperCase())) {
          throw new Error("Cross-origin redirects of requests with bodies are refused");
        }
      }
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && init.method?.toUpperCase() === "POST")) {
        init = { ...init, method: "GET", body: undefined };
        headers.delete("content-type"); headers.delete("content-length");
      }
      target = next;
      continue;
    }
    if (!response.body) return response;
    // Abort remains active through body consumption; enforce the cap while streaming.
    let bytes = 0;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        signal.throwIfAborted();
        bytes += chunk.byteLength;
        if (bytes > 25 * 1024 * 1024) throw new Error("Response exceeds the 25 MB download limit");
        controller.enqueue(chunk);
      },
    }), { signal });
    const bounded = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    Object.defineProperty(bounded, "url", { value: response.url || target });
    Object.defineProperty(bounded, "redirected", { value: target !== url });
    return bounded;
  }
  throw new Error("Too many redirects");
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = DEFAULT_TIMEOUT,
): Promise<Response> {
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
      lastResponse = new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError ?? new Error("all proxies failed");
}
