import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stealthFetcher } from "../../fetchers/stealth.js";

vi.mock("got-scraping", () => ({
  gotScraping: vi.fn(),
}));

describe("stealthFetcher", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("has correct name and tier", () => {
    expect(stealthFetcher.name).toBe("stealth");
    expect(stealthFetcher.tier).toBe(3);
  });

  it("returns null when USE_STEALTH_FETCH is not set", async () => {
    delete process.env.USE_STEALTH_FETCH;
    const result = await stealthFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null when USE_STEALTH_FETCH is not 'true'", async () => {
    process.env.USE_STEALTH_FETCH = "false";
    const result = await stealthFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  });

  it("fetches content when enabled", async () => {
    process.env.USE_STEALTH_FETCH = "true";

    const { gotScraping } = await import("got-scraping");
    vi.mocked(gotScraping).mockResolvedValueOnce({
      statusCode: 200,
      body: `<html><body><article><h1>Real Content</h1><p>${"This is meaningful content. ".repeat(20)}</p></article></body></html>`,
    } as any);

    const result = await stealthFetcher.fetch("https://example.com");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("stealth");
    expect(result!.content).toContain("Real Content");
    expect(result!.quality).toBeGreaterThan(0);
  });

  it("returns null on HTTP error", async () => {
    process.env.USE_STEALTH_FETCH = "true";

    const { gotScraping } = await import("got-scraping");
    vi.mocked(gotScraping).mockResolvedValueOnce({
      statusCode: 403,
      body: "Forbidden",
    } as any);

    const result = await stealthFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    process.env.USE_STEALTH_FETCH = "true";

    const { gotScraping } = await import("got-scraping");
    vi.mocked(gotScraping).mockRejectedValueOnce(new Error("timeout"));

    const result = await stealthFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null for very short responses", async () => {
    process.env.USE_STEALTH_FETCH = "true";

    const { gotScraping } = await import("got-scraping");
    vi.mocked(gotScraping).mockResolvedValueOnce({
      statusCode: 200,
      body: "short",
    } as any);

    const result = await stealthFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  });
});
