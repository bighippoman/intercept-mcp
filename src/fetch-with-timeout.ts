const DEFAULT_TIMEOUT = 10_000;

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
