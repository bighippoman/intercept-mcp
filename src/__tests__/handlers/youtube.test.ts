import { describe, it, expect, vi, beforeEach } from "vitest";
import { youtubeHandler } from "../../handlers/youtube.js";

const TRANSCRIPT_XML = `<?xml version="1.0" encoding="utf-8"?>
<transcript>
  <text start="0" dur="2">Hello world</text>
  <text start="2" dur="3">This is a &amp;quot;test&amp;quot; video</text>
  <text start="5" dur="2">With &amp;#39;entities&amp;#39; too</text>
</transcript>`;

function pageWithCaptions(title: string): string {
  return `<html><body><script>var ytInitialPlayerResponse = {
    "videoDetails": {
      "title": "${title}",
      "author": "Test Channel",
      "shortDescription": "A test video description",
      "lengthSeconds": "120",
      "viewCount": "1000"
    },
    "captions": {
      "playerCaptionsTracklistRenderer": {
        "captionTracks": [
          { "baseUrl": "https://www.youtube.com/api/timedtext?v=abc&lang=en", "languageCode": "en" }
        ]
      }
    }
  };</script></body></html>`;
}

describe("youtubeHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and patterns", () => {
    expect(youtubeHandler.name).toBe("youtube");
    expect(youtubeHandler.patterns.some(p => p.test("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))).toBe(true);
    expect(youtubeHandler.patterns.some(p => p.test("https://youtu.be/dQw4w9WgXcQ"))).toBe(true);
    expect(youtubeHandler.patterns.some(p => p.test("https://example.com/video"))).toBe(false);
  });

  it("extracts metadata and transcript from video page", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(pageWithCaptions("Test Video Title"), { status: 200 }))
      .mockResolvedValueOnce(new Response(TRANSCRIPT_XML, { status: 200 }));

    const result = await youtubeHandler.handle("https://www.youtube.com/watch?v=abc123");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("youtube");
    expect(result!.content).toContain("Test Video Title");
    expect(result!.content).toContain("Test Channel");
    expect(result!.content).toContain("A test video description");
    expect(result!.content).toContain("## Transcript");
    expect(result!.content).toContain("Hello world");
  });

  it("decodes double-encoded entities in transcripts", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(pageWithCaptions("Entity Test"), { status: 200 }))
      .mockResolvedValueOnce(new Response(TRANSCRIPT_XML, { status: 200 }));

    const result = await youtubeHandler.handle("https://www.youtube.com/watch?v=ent123");
    expect(result!.content).toContain(`This is a "test" video`);
    expect(result!.content).toContain("With 'entities' too");
  });

  it("handles youtu.be short URLs", async () => {
    const videoPageHtml = `<html><body><script>var ytInitialPlayerResponse = {
      "videoDetails": { "title": "Short URL Video", "author": "Ch", "shortDescription": "desc", "lengthSeconds": "60", "viewCount": "500" },
      "captions": { "playerCaptionsTracklistRenderer": { "captionTracks": [] } }
    };</script></body></html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(videoPageHtml, { status: 200 }));

    const result = await youtubeHandler.handle("https://youtu.be/xyz789");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Short URL Video");
  });

  it("returns metadata-only result when no captions available", async () => {
    const videoPageHtml = `<html><body><script>var ytInitialPlayerResponse = {
      "videoDetails": { "title": "No Captions Video", "author": "Channel", "shortDescription": "A description", "lengthSeconds": "300", "viewCount": "2000" },
      "captions": { "playerCaptionsTracklistRenderer": { "captionTracks": [] } }
    };</script></body></html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(videoPageHtml, { status: 200 }));

    const result = await youtubeHandler.handle("https://www.youtube.com/watch?v=nocaps");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("No Captions Video");
    expect(result!.content).toContain("A description");
    expect(result!.content).not.toContain("## Transcript");
  });

  it("returns metadata-only result when the page has no captions key", async () => {
    const html = `<html><body><script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Test Video","author":"Channel","shortDescription":"Description","lengthSeconds":"120","viewCount":"1000"}};</script></body></html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(html, { status: 200 }));

    const result = await youtubeHandler.handle("https://www.youtube.com/watch?v=test456");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Test Video");
    expect(result!.content).not.toContain("## Transcript");
  });

  it("falls back to metadata-only when the transcript fetch fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(pageWithCaptions("Resilient Video"), { status: 200 }))
      .mockRejectedValueOnce(new Error("timedtext unavailable"));

    const result = await youtubeHandler.handle("https://www.youtube.com/watch?v=failcap");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Resilient Video");
    expect(result!.content).not.toContain("## Transcript");
  });

  it("prefers human-made English captions over auto-generated", async () => {
    const html = `<html><body><script>var ytInitialPlayerResponse = {
      "videoDetails": { "title": "Multi Track", "author": "Ch", "shortDescription": "d", "lengthSeconds": "60", "viewCount": "1" },
      "captions": { "playerCaptionsTracklistRenderer": { "captionTracks": [
        { "baseUrl": "https://yt.test/asr", "languageCode": "en", "kind": "asr" },
        { "baseUrl": "https://yt.test/human", "languageCode": "en" }
      ] } }
    };</script></body></html>`;

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response(TRANSCRIPT_XML, { status: 200 }));

    await youtubeHandler.handle("https://www.youtube.com/watch?v=multi");
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "https://yt.test/human", expect.anything());
  });

  it("returns null on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Not Found", { status: 404 }));
    const result = await youtubeHandler.handle("https://www.youtube.com/watch?v=missing");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await youtubeHandler.handle("https://www.youtube.com/watch?v=error");
    expect(result).toBeNull();
  });
});
