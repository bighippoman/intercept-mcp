const DEFAULT_TIMEOUT = 10_000;

// If any standard proxy env var is set, route all fetch() through it.
// EnvHttpProxyAgent honors HTTPS_PROXY / HTTP_PROXY / NO_PROXY (and lowercase).
// Dynamic import avoids undici overriding the global fetch (which breaks
// decompression in undici >=7.27).
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

export function getProxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy
  );
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms = DEFAULT_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
