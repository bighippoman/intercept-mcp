import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flaresolverrFetcher } from "../../fetchers/flaresolverr.js";

const ARTICLE_HTML = `<html><body><article><h1>Behind Cloudflare</h1><p>${"Content that was behind a challenge and is now solved. ".repeat(8)}</p></article></body></html>`;

describe("flaresolverrFetcher", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("has the expected name and tier", () => {
    expect(flaresolverrFetcher.name).toBe("flaresolverr");
    expect(flaresolverrFetcher.tier).toBe(3);
  });

  it("returns null when FLARESOLVERR_URL is not set", async () => {
    delete process.env.FLARESOLVERR_URL;
    const spy = vi.spyOn(globalThis, "fetch");
    const result = await flaresolverrFetcher.fetch("https://example.com/protected");
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("posts to the /v1 endpoint and parses the solved HTML", async () => {
    process.env.FLARESOLVERR_URL = "http://localhost:8191";
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      expect(String(input)).toBe("http://localhost:8191/v1");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body.cmd).toBe("request.get");
      expect(body.url).toBe("https://example.com/protected");
      return Promise.resolve(new Response(JSON.stringify({
        status: "ok",
        solution: { status: 200, response: ARTICLE_HTML },
      }), { status: 200 }));
    });

    const result = await flaresolverrFetcher.fetch("https://example.com/protected");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("flaresolverr");
    expect(result!.content).toContain("Behind Cloudflare");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("appends /v1 only when missing", async () => {
    process.env.FLARESOLVERR_URL = "http://solver.internal:8191/v1/";
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      expect(String(input)).toBe("http://solver.internal:8191/v1");
      return Promise.resolve(new Response(JSON.stringify({ status: "ok", solution: { status: 200, response: ARTICLE_HTML } }), { status: 200 }));
    });
    const result = await flaresolverrFetcher.fetch("https://example.com/x");
    expect(result).not.toBeNull();
  });

  it("returns null when FlareSolverr reports a non-ok status", async () => {
    process.env.FLARESOLVERR_URL = "http://localhost:8191";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "error", message: "challenge failed" }), { status: 200 })
    );
    const result = await flaresolverrFetcher.fetch("https://example.com/protected");
    expect(result).toBeNull();
  });

  it("returns null when the solved HTTP status is an error", async () => {
    process.env.FLARESOLVERR_URL = "http://localhost:8191";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", solution: { status: 403, response: "blocked" } }), { status: 200 })
    );
    const result = await flaresolverrFetcher.fetch("https://example.com/protected");
    expect(result).toBeNull();
  });

  it("returns null on network failure", async () => {
    process.env.FLARESOLVERR_URL = "http://localhost:8191";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await flaresolverrFetcher.fetch("https://example.com/protected");
    expect(result).toBeNull();
  });
});
