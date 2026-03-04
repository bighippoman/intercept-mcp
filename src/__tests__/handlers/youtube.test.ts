import { describe, it, expect, vi, beforeEach } from "vitest";
import { youtubeHandler } from "../../handlers/youtube.js";

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
    const videoPageHtml = `
      <html><head><title>Test Video - YouTube</title></head><body>
      <script>var ytInitialPlayerResponse = {
        "videoDetails": {
          "title": "Test Video Title",
          "author": "Test Channel",
          "shortDescription": "A test video description",
          "lengthSeconds": "120",
          "viewCount": "1000"
        },
        "captions": {
          "playerCaptionsTracklistRenderer": {
            "captionTracks": [{
              "baseUrl": "https://www.youtube.com/api/timedtext?v=abc&lang=en",
              "languageCode": "en"
            }]
          }
        }
      };</script>
      </body></html>
    `;
    const captionXml = `<?xml version="1.0" encoding="utf-8"?>
      <transcript>
        <text start="0" dur="5">Hello world</text>
        <text start="5" dur="3">This is a test</text>
        <text start="8" dur="4">Thank you for watching</text>
      </transcript>`;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(videoPageHtml, { status: 200 }));

    const result = await youtubeHandler.handle("https://www.youtube.com/watch?v=abc123");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("youtube");
    expect(result!.content).toContain("Test Video Title");
    expect(result!.content).toContain("Test Channel");
    expect(result!.content).toContain("A test video description");
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
