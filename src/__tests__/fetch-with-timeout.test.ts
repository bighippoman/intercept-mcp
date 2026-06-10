import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeout, getProxyUrl, __resetProxyStateForTests } from "../fetch-with-timeout.js";

const originalEnv = { ...process.env };

function ok(status = 200) {
  return new Response("body", { status });
}

describe("fetch-with-timeout proxy rotation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetProxyStateForTests();
    delete process.env.INTERCEPT_PROXIES;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    __resetProxyStateForTests();
  });

  it("makes a single un-proxied request when no rotation list is set", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    await fetchWithTimeout("https://example.com");
    expect(spy).toHaveBeenCalledTimes(1);
    const init = spy.mock.calls[0][1] as { dispatcher?: unknown };
    expect(init.dispatcher).toBeUndefined();
  });

  it("attaches a dispatcher when INTERCEPT_PROXIES is set", async () => {
    process.env.INTERCEPT_PROXIES = "http://p1.test:8080";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    await fetchWithTimeout("https://example.com");
    const init = spy.mock.calls[0][1] as { dispatcher?: unknown };
    expect(init.dispatcher).toBeDefined();
  });

  it("retries through the next proxy on a block status and returns the success", async () => {
    process.env.INTERCEPT_PROXIES = "http://p1.test:8080, http://p2.test:8080";
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok(403))
      .mockResolvedValueOnce(ok(200));

    const response = await fetchWithTimeout("https://example.com");
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retries on a network error", async () => {
    process.env.INTERCEPT_PROXIES = "http://p1.test:8080, http://p2.test:8080";
    const spy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(ok(200));

    const response = await fetchWithTimeout("https://example.com");
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns the last response when every proxy is blocked", async () => {
    process.env.INTERCEPT_PROXIES = "http://p1.test, http://p2.test";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(429));
    const response = await fetchWithTimeout("https://example.com");
    expect(response.status).toBe(429);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("caps rotation attempts even with many proxies", async () => {
    process.env.INTERCEPT_PROXIES = "http://a, http://b, http://c, http://d, http://e";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(503));
    await fetchWithTimeout("https://example.com");
    expect(spy).toHaveBeenCalledTimes(3); // MAX_ROTATION_ATTEMPTS
  });

  it("does not retry on a non-block error status like 404", async () => {
    process.env.INTERCEPT_PROXIES = "http://p1.test, http://p2.test";
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(404));
    const response = await fetchWithTimeout("https://example.com");
    expect(response.status).toBe(404);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("throws when every proxy errors", async () => {
    process.env.INTERCEPT_PROXIES = "http://p1.test, http://p2.test";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(fetchWithTimeout("https://example.com")).rejects.toThrow();
  });
});

describe("getProxyUrl", () => {
  beforeEach(() => {
    __resetProxyStateForTests();
    delete process.env.INTERCEPT_PROXIES;
    delete process.env.HTTPS_PROXY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    __resetProxyStateForTests();
  });

  it("returns undefined when nothing is configured", () => {
    expect(getProxyUrl()).toBeUndefined();
  });

  it("falls back to the standard single proxy var", () => {
    process.env.HTTPS_PROXY = "http://single.test:8080";
    expect(getProxyUrl()).toBe("http://single.test:8080");
  });

  it("round-robins across the rotation list", () => {
    process.env.INTERCEPT_PROXIES = "http://a, http://b, http://c";
    expect(getProxyUrl()).toBe("http://a");
    expect(getProxyUrl()).toBe("http://b");
    expect(getProxyUrl()).toBe("http://c");
    expect(getProxyUrl()).toBe("http://a");
  });

  it("ignores malformed entries in the list", () => {
    process.env.INTERCEPT_PROXIES = "not a url, http://valid.test:8080, ftp://nope";
    expect(getProxyUrl()).toBe("http://valid.test:8080");
    expect(getProxyUrl()).toBe("http://valid.test:8080");
  });
});
