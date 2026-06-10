import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { Handler, HandlerResult } from "../types.js";

const TRANSCRIPT_CHAR_LIMIT = 15_000;

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
  kind?: string; // "asr" = auto-generated
}

interface PlayerData {
  details: VideoDetails;
  captionTracks: CaptionTrack[];
}

function parsePlayerResponse(html: string): PlayerData | null {
  const match = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    const details = data.videoDetails as VideoDetails | undefined;
    if (!details) return null;
    const captionTracks =
      (data.captions?.playerCaptionsTracklistRenderer?.captionTracks as CaptionTrack[] | undefined) ?? [];
    return { details, captionTracks };
  } catch {
    return null;
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Prefer human-made English captions, then any English, then any human-made, then whatever exists. */
function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  const usable = tracks.filter((t) => t.baseUrl);
  if (usable.length === 0) return null;
  const english = usable.filter((t) => t.languageCode?.startsWith("en"));
  return (
    english.find((t) => t.kind !== "asr") ??
    english[0] ??
    usable.find((t) => t.kind !== "asr") ??
    usable[0]
  );
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))); // double-encoded (&amp;#39;)
}

/**
 * Fetch the transcript directly from the caption track URL embedded in the
 * watch page. The timedtext endpoint returns XML: <text start dur>...</text>.
 */
async function getTranscript(tracks: CaptionTrack[]): Promise<string | null> {
  const track = pickCaptionTrack(tracks);
  if (!track) return null;

  try {
    const response = await fetchWithTimeout(track.baseUrl, {}, 8_000);
    if (!response.ok) return null;
    const xml = await response.text();

    const segments: string[] = [];
    for (const m of xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)) {
      const cleaned = decodeEntities(m[1]).replace(/<[^>]+>/g, "").trim();
      if (cleaned) segments.push(cleaned);
    }
    if (segments.length === 0) return null;

    const text = segments.join(" ").replace(/\s+/g, " ");
    return text.length > TRANSCRIPT_CHAR_LIMIT
      ? text.slice(0, TRANSCRIPT_CHAR_LIMIT) + "\n\n[Transcript truncated]"
      : text;
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
      const parsed = parsePlayerResponse(html);
      if (!parsed) return null;
      const { details, captionTracks } = parsed;

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

      const transcript = await getTranscript(captionTracks);
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
