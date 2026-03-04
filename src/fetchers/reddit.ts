import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

interface RedditResponse {
  data: {
    children: Array<{
      data: {
        title: string;
        selftext: string;
        subreddit: string;
        score: number;
        num_comments: number;
        permalink: string;
      };
    }>;
  };
}

export const redditFetcher: Fetcher = {
  name: "reddit",
  tier: 4,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();
    try {
      const apiUrl = `https://www.reddit.com/search.json?q=url:${encodeURIComponent(url)}&sort=relevance&limit=5`;
      const response = await fetch(apiUrl, {
        headers: { "User-Agent": "intercept-mcp/1.0" },
      });
      if (!response.ok) return null;
      const data = (await response.json()) as RedditResponse;
      if (!data.data.children.length) return null;
      const parts: string[] = ["# Reddit Discussions", ""];
      for (const child of data.data.children) {
        const post = child.data;
        parts.push(`## ${post.title}`);
        parts.push(
          `- r/${post.subreddit} | Score: ${post.score} | Comments: ${post.num_comments}`
        );
        parts.push(`- https://reddit.com${post.permalink}`);
        if (post.selftext) parts.push("", post.selftext.slice(0, 500));
        parts.push("");
      }
      const content = parts.join("\n");
      return {
        content,
        source: "reddit",
        quality: scoreContent(content),
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
