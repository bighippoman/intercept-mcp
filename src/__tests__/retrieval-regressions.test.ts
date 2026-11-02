import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer as createHttpServer } from "node:http";
import { performFetch } from "../server.js";
import { LRUCache } from "../cache.js";
import { fetchWithTimeout, __resetProxyStateForTests } from "../fetch-with-timeout.js";
import { __resetAuthForTests } from "../auth.js";
import { sharedCacheRead } from "../shared-cache.js";
import { normalizeUrl } from "../normalize.js";
import { scoreContent } from "../quality.js";
import { SingleFlight } from "../single-flight.js";

const prose = '# Research methods\n\n' + 'Evidence should include source links and the date of retrieval. Reliable extraction preserves paragraphs and tables so readers can verify the original source. '.repeat(8);
const url = 'https://research.example.com/article';
const cache = () => new LRUCache(20, { ttl: 60_000, failureTtl: 60_000 });
beforeEach(() => {
  for (const name of ['CF_API_TOKEN','CF_ACCOUNT_ID','INTERCEPT_AUTH','INTERCEPT_PROXIES','FLARESOLVERR_URL','WEB_UNLOCKER_URL']) vi.stubEnv(name, '');
  vi.stubEnv('INTERCEPT_SHARED_CACHE', 'false');
  __resetAuthForTests(); __resetProxyStateForTests();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); __resetAuthForTests(); __resetProxyStateForTests(); });

describe('retrieval contracts', () => {
  it('a shallow failure does not prevent a deeper retry', async () => {
    let hosted = false;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      hosted && String(input).startsWith('https://r.jina.ai/') ? new Response(prose) : new Response('unavailable', { status: 404 }));
    const c = cache();
    expect((await performFetch(c, url, { maxTier: 1 })).ok).toBe(false);
    const before = spy.mock.calls.length;
    hosted = true;
    const recovered = await performFetch(c, url, { maxTier: 2 });
    expect(recovered.ok).toBe(true);
    expect(recovered.pipelineResult.result.source).toBe('jina');
    expect(spy.mock.calls.length).toBeGreaterThan(before);
  });

  it('authenticated reads contact only the origin and carry its credentials', async () => {
    vi.stubEnv('INTERCEPT_AUTH', JSON.stringify({ 'research.example.com': { Cookie: 'dummy-test-session' } }));
    __resetAuthForTests();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(prose, { headers: { 'content-type': 'text/markdown' } }));
    const result = await performFetch(cache(), url);
    expect(result.ok).toBe(true);
    for (const [input, init] of spy.mock.calls) {
      expect(new URL(String(input)).hostname).toBe('research.example.com');
      expect(new Headers(init?.headers).get('cookie')).toBe('dummy-test-session');
    }
  });

  it('unavailable pages and unreadable PDFs are failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('unavailable', { status: 404 }));
    expect((await performFetch(cache(), url)).ok).toBe(false);
    vi.mocked(globalThis.fetch).mockImplementation(async () => new Response('invalid PDF'));
    expect((await performFetch(cache(), url + '.pdf')).ok).toBe(false);
  });

  it('rejects truncated, stale, mismatched and blocked shared cache responses', async () => {
    const valid = { url, markdown: prose, source: 'raw', trust_level: 100, age_seconds: 10 };
    for (const change of [{ truncated: true }, { age_seconds: 4000 }, { content_hash: 'mismatched' }, { retrieved_at: 'invalid-date' }, { retrieved_at: '2099-01-01T00:00:00Z' }, { url: 'https://other.example.org/' }, { markdown: '# Just a moment\n\n' + prose }]) {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ...valid, ...change })));
      expect(await sharedCacheRead(url)).toBeNull();
    }
  });

  it('preserves distinct document identities and signed query strings', () => {
    for (const input of ['http://example.com/Case/?variant=blue&access=demo&ref=branch', 'https://www.example.com/page/', 'https://example.com/page?signature=demo&utm_source=signed', 'https://example.com/#/articles/one']) {
      expect(normalizeUrl(input)).toBe(input);
    }
  });

  it('does not classify a substantive CAPTCHA article as a challenge', () => {
    expect(scoreContent('# Understanding CAPTCHA\n\n' + prose)).toBeGreaterThan(0.3);
  });
});

describe('download lifecycle', () => {
  it('keeps its deadline active after headers arrive', async () => {
    const server = createHttpServer((_, response) => { response.writeHead(200); response.flushHeaders(); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address() as { port: number };
      const response = await fetchWithTimeout(`http://127.0.0.1:${address.port}/`, {}, 80);
      await expect(response.text()).rejects.toThrow();
    } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('does not initiate a request with an already-cancelled signal', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const controller = new AbortController(); controller.abort();
    await expect(fetchWithTimeout(url, { signal: controller.signal })).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('strips custom secrets on cross-origin redirects', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://other.example.org/' } }))
      .mockResolvedValueOnce(new Response('public response'));
    const response = await fetchWithTimeout(url, { headers: { 'X-Private-Key': 'dummy' } });
    await response.text();
    expect(new Headers(spy.mock.calls[1][1]?.headers).get('X-Private-Key')).toBeNull();
  });

  it('refuses a redirect to an internal target', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }));
    await expect(fetchWithTimeout(url)).rejects.toThrow('Redirect refused');
  });

  it('coalesces work while allowing one waiter to cancel independently', async () => {
    const flight = new SingleFlight<string>();
    let finish!: (v: string) => void;
    const start = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const first = flight.run('same', controller.signal, start);
    const second = flight.run('same', undefined, start);
    await Promise.resolve(); controller.abort();
    await expect(first).rejects.toThrow();
    finish('done');
    await expect(second).resolves.toBe('done');
    expect(start).toHaveBeenCalledTimes(1);
  });
});
