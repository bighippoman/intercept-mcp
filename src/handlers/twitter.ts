import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { Handler, HandlerResult } from "../types.js";

interface TweetData {
  author: string;
  handle: string;
  text: string;
  date: string;
  likes: number;
  retweets: number;
  replies: number;
  photos: string[];
  videos: string[];
  quote?: { author: string; handle: string; text: string };
}

function extractTweetPath(url: string): { user: string; id: string } | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/);
  return match ? { user: match[1], id: match[2] } : null;
}

async function tryFxTwitter(user: string, id: string): Promise<TweetData | null> {
  try {
    const resp = await fetchWithTimeout(`https://api.fxtwitter.com/${user}/status/${id}`, {}, 8000);
    if (!resp.ok) return null;
    const data = await resp.json();
    const t = data.tweet;
    if (!t) return null;
    return {
      author: t.author.name,
      handle: t.author.screen_name,
      text: t.text,
      date: t.created_at,
      likes: t.likes,
      retweets: t.retweets,
      replies: t.replies,
      photos: t.media?.photos?.map((p: { url: string }) => p.url) ?? [],
      videos: t.media?.videos?.map((v: { url: string }) => v.url) ?? [],
      quote: t.quote ? { author: t.quote.author.name, handle: t.quote.author.screen_name, text: t.quote.text } : undefined,
    };
  } catch { return null; }
}

async function tryVxTwitter(user: string, id: string): Promise<TweetData | null> {
  try {
    const resp = await fetchWithTimeout(`https://api.vxtwitter.com/${user}/status/${id}`, {}, 8000);
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return null;
    const t = await resp.json();
    if (!t.text) return null;
    return {
      author: t.user_name,
      handle: t.user_screen_name,
      text: t.text,
      date: t.date,
      likes: t.likes,
      retweets: t.retweets,
      replies: t.replies,
      photos: (t.mediaURLs ?? []).filter((u: string) => /\.(jpg|png|webp)/i.test(u)),
      videos: (t.mediaURLs ?? []).filter((u: string) => /\.mp4/i.test(u)),
      quote: t.qrt ? { author: t.qrt.user_name, handle: t.qrt.user_screen_name, text: t.qrt.text } : undefined,
    };
  } catch { return null; }
}

async function trySyndication(id: string): Promise<TweetData | null> {
  try {
    const resp = await fetchWithTimeout(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=x`, {}, 8000);
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("application/json") || !resp.ok) return null;
    const t = await resp.json();
    if (!t.text) return null;
    return {
      author: t.user?.name ?? "",
      handle: t.user?.screen_name ?? "",
      text: t.text,
      date: t.created_at,
      likes: t.favorite_count ?? 0,
      retweets: t.conversation_count ?? 0,
      replies: 0,
      photos: [],
      videos: [],
    };
  } catch { return null; }
}

function formatTweet(tweet: TweetData): string {
  const parts: string[] = [];
  parts.push(`**${tweet.author}** (@${tweet.handle})`);
  parts.push(`*${tweet.date}*`);
  parts.push("");
  parts.push(tweet.text);
  parts.push("");

  if (tweet.quote) {
    parts.push(`> **${tweet.quote.author}** (@${tweet.quote.handle})`);
    parts.push(`> ${tweet.quote.text}`);
    parts.push("");
  }

  for (const photo of tweet.photos) parts.push(`![](${photo})`);
  if (tweet.photos.length) parts.push("");
  for (const video of tweet.videos) parts.push(`[Video](${video})`);
  if (tweet.videos.length) parts.push("");

  parts.push(`Likes: ${tweet.likes} | Retweets: ${tweet.retweets} | Replies: ${tweet.replies}`);
  return parts.join("\n");
}

export const twitterHandler: Handler = {
  name: "twitter",
  patterns: [
    /twitter\.com\/\w+\/status\/\d+/,
    /x\.com\/\w+\/status\/\d+/,
  ],
  async handle(url: string): Promise<HandlerResult | null> {
    const start = Date.now();
    const parsed = extractTweetPath(url);
    if (!parsed) return null;

    const { user, id } = parsed;

    // FxTwitter → VxTwitter → Syndication fallback chain
    const tweet =
      await tryFxTwitter(user, id) ??
      await tryVxTwitter(user, id) ??
      await trySyndication(id);

    if (!tweet) return null;

    return {
      content: formatTweet(tweet),
      source: "twitter",
      timing: Date.now() - start,
    };
  },
};
