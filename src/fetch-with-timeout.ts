import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

const DEFAULT_TIMEOUT = 10_000;

// If any standard proxy env var is set, route all fetch() through it.
// EnvHttpProxyAgent honors HTTPS_PROXY / HTTP_PROXY / NO_PROXY (and lowercase).
if (
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  process.env.ALL_PROXY ||
  process.env.all_proxy
) {
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
