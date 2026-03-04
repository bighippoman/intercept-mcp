import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { Handler, HandlerResult } from "../types.js";

interface FxTweetResponse {
  tweet: {
    author: { name: string; screen_name: string };
    text: string;
    created_at: string;
    media?: {
      photos?: Array<{ url: string }>;
      videos?: Array<{ url: string }>;
    };
    likes: number;
    retweets: number;
    replies: number;
    quote?: {
      author: { name: string; screen_name: string };
      text: string;
    };
  };
}

function extractTweetPath(url: string): string | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/);
  return match ? `${match[1]}/status/${match[2]}` : null;
}

export const twitterHandler: Handler = {
  name: "twitter",
  patterns: [
    /twitter\.com\/\w+\/status\/\d+/,
    /x\.com\/\w+\/status\/\d+/,
  ],
  async handle(url: string): Promise<HandlerResult | null> {
    const start = Date.now();
    const path = extractTweetPath(url);
    if (!path) return null;

    try {
      const response = await fetchWithTimeout(`https://api.fxtwitter.com/${path}`);
      if (!response.ok) return null;
      const data = (await response.json()) as FxTweetResponse;
      const tweet = data.tweet;

      const parts: string[] = [];
      parts.push(`**${tweet.author.name}** (@${tweet.author.screen_name})`);
      parts.push(`*${tweet.created_at}*`);
      parts.push("");
      parts.push(tweet.text);
      parts.push("");

      if (tweet.quote) {
        parts.push(`> **${tweet.quote.author.name}** (@${tweet.quote.author.screen_name})`);
        parts.push(`> ${tweet.quote.text}`);
        parts.push("");
      }

      if (tweet.media?.photos?.length) {
        for (const photo of tweet.media.photos) {
          parts.push(`![](${photo.url})`);
        }
        parts.push("");
      }
      if (tweet.media?.videos?.length) {
        for (const video of tweet.media.videos) {
          parts.push(`[Video](${video.url})`);
        }
        parts.push("");
      }

      parts.push(`Likes: ${tweet.likes} | Retweets: ${tweet.retweets} | Replies: ${tweet.replies}`);

      return {
        content: parts.join("\n"),
        source: "twitter",
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
