import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { Handler, HandlerResult } from "../types.js";

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

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
}

function parsePlayerResponse(html: string): { details: VideoDetails | null; captionTracks: CaptionTrack[] } {
  const match = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return { details: null, captionTracks: [] };

  try {
    const data = JSON.parse(match[1]);
    const details = data.videoDetails as VideoDetails | undefined;
    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks as CaptionTrack[] | undefined;
    return { details: details ?? null, captionTracks: tracks ?? [] };
  } catch {
    return { details: null, captionTracks: [] };
  }
}

function parseTranscriptXml(xml: string): string {
  const lines: string[] = [];
  const regex = /<text\s+start="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const seconds = parseFloat(match[1]);
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const timestamp = `${minutes}:${String(secs).padStart(2, "0")}`;
    const text = match[2]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    if (text) lines.push(`[${timestamp}] ${text}`);
  }
  return lines.join("\n");
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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
      const { details, captionTracks } = parsePlayerResponse(html);
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

      const enTrack = captionTracks.find((t) => t.languageCode === "en") ?? captionTracks[0];
      if (enTrack) {
        try {
          const captionResponse = await fetchWithTimeout(enTrack.baseUrl);
          if (captionResponse.ok) {
            const xml = await captionResponse.text();
            const transcript = parseTranscriptXml(xml);
            if (transcript) {
              parts.push("## Transcript");
              parts.push(transcript);
            }
          }
        } catch {
          // No transcript available, continue with metadata only
        }
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
