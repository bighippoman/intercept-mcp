import { describe, it, expect, vi, beforeEach } from "vitest";
import { twitterHandler } from "../../handlers/twitter.js";

describe("twitterHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and patterns", () => {
    expect(twitterHandler.name).toBe("twitter");
    expect(twitterHandler.patterns).toHaveLength(2);
    expect(twitterHandler.patterns[0].test("https://twitter.com/user/status/123")).toBe(true);
    expect(twitterHandler.patterns[1].test("https://x.com/user/status/456")).toBe(true);
    expect(twitterHandler.patterns[0].test("https://twitter.com/user")).toBe(false);
  });

  it("fetches tweet via FxTwitter API", async () => {
    const mockResponse = {
      tweet: {
        author: { name: "Test User", screen_name: "testuser" },
        text: "Hello world! This is a test tweet with enough content.",
        created_at: "Mon Jan 01 12:00:00 +0000 2024",
        media: { photos: [{ url: "https://pbs.twimg.com/media/photo.jpg" }] },
        likes: 42,
        retweets: 10,
        replies: 5,
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await twitterHandler.handle("https://twitter.com/testuser/status/123456");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("twitter");
    expect(result!.content).toContain("Test User");
    expect(result!.content).toContain("@testuser");
    expect(result!.content).toContain("Hello world!");
    expect(result!.content).toContain("photo.jpg");
  });

  it("extracts tweet ID from x.com URLs", async () => {
    const mockResponse = {
      tweet: {
        author: { name: "User", screen_name: "user" },
        text: "Test tweet content here with enough text to be meaningful.",
        created_at: "Mon Jan 01 12:00:00 +0000 2024",
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await twitterHandler.handle("https://x.com/user/status/789");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("api.fxtwitter.com"),
      expect.anything()
    );
    expect(result).not.toBeNull();
  });

  it("returns null on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );
    const result = await twitterHandler.handle("https://twitter.com/user/status/999");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await twitterHandler.handle("https://twitter.com/user/status/999");
    expect(result).toBeNull();
  });
});
