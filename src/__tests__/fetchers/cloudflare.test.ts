import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cloudflareFetcher } from "../../fetchers/cloudflare.js";

describe("cloudflareFetcher", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("has correct name and tier", () => {
    expect(cloudflareFetcher.name).toBe("cloudflare");
    expect(cloudflareFetcher.tier).toBe(1);
  });

  it("returns null when env vars are not set", async () => {
    delete process.env.CF_ACCOUNT_ID;
    delete process.env.CF_API_TOKEN;
    const result = await cloudflareFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  });

  it("returns markdown content on success", async () => {
    process.env.CF_ACCOUNT_ID = "test-account";
    process.env.CF_API_TOKEN = "test-token";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        success: true,
        result: "# Example\n\n" + "This is example content that is long enough to pass quality scoring thresholds for the test to work properly and verify markdown extraction from the API. ".repeat(3),
      }), { status: 200 })
    );

    const result = await cloudflareFetcher.fetch("https://example.com");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("# Example");
    expect(result!.source).toBe("cloudflare");
    expect(result!.quality).toBeGreaterThan(0);
  });

  it("sends correct request to CF API", async () => {
    process.env.CF_ACCOUNT_ID = "my-account";
    process.env.CF_API_TOKEN = "my-token";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: "# Content\n\n" + "x".repeat(300) }), { status: 200 })
    );

    await cloudflareFetcher.fetch("https://example.com");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/my-account/browser-rendering/markdown",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer my-token",
        }),
      })
    );
  });

  it("returns null on API error", async () => {
    process.env.CF_ACCOUNT_ID = "test-account";
    process.env.CF_API_TOKEN = "test-token";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );
    const result = await cloudflareFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    process.env.CF_ACCOUNT_ID = "test-account";
    process.env.CF_API_TOKEN = "test-token";
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));
    const result = await cloudflareFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  });
});
