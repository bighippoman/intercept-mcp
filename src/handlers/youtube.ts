import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { Handler, HandlerResult } from "../types.js";
import { fetchTranscript } from "youtube-transcript";

function extractVideoId(url: string): string | null {
  const longMatch = url.match(/youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]+)/);
  if (longMatch) return longMatch[1];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  return shortMatch ? shortMatch[1] : null;
}

interface VideoDetails {
  title: string;
  author: string;
  shortDescription: string;
  lengthSeconds: string;
  viewCount: string;
}

function parsePlayerResponse(html: string): VideoDetails | null {
  const match = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    return (data.videoDetails as VideoDetails | undefined) ?? null;
  } catch {
    return null;
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function getTranscript(videoId: string): Promise<string | null> {
  try {
    const segments = await fetchTranscript(videoId);
    if (!segments || segments.length === 0) return null;
    const text = segments.map((s: { text: string }) => s.text).join(" ");
    return text.length > 15_000 ? text.slice(0, 15_000) + "\n\n[Transcript truncated]" : text;
  } catch {
    return null;
  }
}

export const youtubeHandler: Handler = {
  name: "youtube",
  patterns: [
    /youtube\.com\/watch\?.*v=[a-zA-Z0-9_-]+/,
    /youtu\.be\/[a-zA-Z0-9_-]+/,
  ],
  async handle(url: string): Promise<HandlerResult | null> {
    const start = Date.now();
    const videoId = extractVideoId(url);
    if (!videoId) return null;

    try {
      const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const response = await fetchWithTimeout(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (!response.ok) return null;
      const html = await response.text();
      const details = parsePlayerResponse(html);
      if (!details) return null;

      const parts: string[] = [];
      parts.push(`# ${details.title}`);
      parts.push(`**Channel:** ${details.author}`);
      parts.push(`**Duration:** ${formatDuration(parseInt(details.lengthSeconds, 10))}`);
      parts.push(`**Views:** ${parseInt(details.viewCount, 10).toLocaleString()}`);
      parts.push("");

      if (details.shortDescription) {
        parts.push("## Description");
        parts.push(details.shortDescription);
        parts.push("");
      }

      const transcript = await getTranscript(videoId);
      if (transcript) {
        parts.push("## Transcript");
        parts.push(transcript);
        parts.push("");
      }

      return {
        content: parts.join("\n"),
        source: "youtube",
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
