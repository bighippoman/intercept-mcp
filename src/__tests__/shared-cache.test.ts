import { afterEach, describe, expect, it, vi } from "vitest";
import { sharedCacheRead } from "../shared-cache.js";

const LONG_MARKDOWN = `# Cached Page\n\n${"direct content ".repeat(60)}`;

function mockCacheResponse(body: unknown): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  ));
}

describe("sharedCacheRead", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns direct shared-cache content", async () => {
    mockCacheResponse({
      url: "https://example.com",
      markdown: LONG_MARKDOWN,
      trust_level: 1,
      source: "raw",
      age_seconds: 10,
    });

    const result = await sharedCacheRead("https://example.com");

    expect(result).toMatchObject({
      content: LONG_MARKDOWN,
      source: "agentsweb (trust:1, via:raw)",
      quality: 0.6,
    });
  });

  it("rejects indirect shared-cache sources that can describe a page instead of fetching it", async () => {
    mockCacheResponse({
      url: "https://example.com",
      markdown: `# HackerNews Discussions\n\n${"discussion link ".repeat(60)}`,
      trust_level: 5,
      source: "hackernews",
      age_seconds: 10,
    });

    await expect(sharedCacheRead("https://example.com")).resolves.toBeNull();
  });
});
