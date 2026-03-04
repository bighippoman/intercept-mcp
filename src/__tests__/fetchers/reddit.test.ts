import { describe, it, expect, vi, beforeEach } from "vitest";
import { redditFetcher } from "../../fetchers/reddit.js";

describe("redditFetcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and tier", () => {
    expect(redditFetcher.name).toBe("reddit");
    expect(redditFetcher.tier).toBe(4);
  });

  it("searches Reddit and returns discussion content", async () => {
    const apiResponse = {
      data: {
        children: [
          {
            data: {
              title: "Check out this article",
              selftext:
                "I found this really interesting article about software engineering. ".repeat(
                  5
                ),
              subreddit: "programming",
              score: 200,
              num_comments: 30,
              permalink:
                "/r/programming/comments/abc123/check_out_this_article/",
            },
          },
        ],
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(apiResponse), { status: 200 })
    );
    const result = await redditFetcher.fetch("https://example.com/article");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Check out this article");
    expect(result!.source).toBe("reddit");
  });

  it("returns null when no Reddit results", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { children: [] } }), { status: 200 })
    );
    expect(
      await redditFetcher.fetch("https://example.com/obscure")
    ).toBeNull();
  });
});
