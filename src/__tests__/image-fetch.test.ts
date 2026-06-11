import { describe, it, expect, vi, beforeEach } from "vitest";
import { isImageUrl, fetchImage } from "../image-fetch.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 9]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 1]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);

function imgResponse(bytes: Uint8Array, contentType: string) {
  return new Response(bytes, { status: 200, headers: { "content-type": contentType } });
}

describe("isImageUrl", () => {
  it("matches image extensions", () => {
    expect(isImageUrl("https://example.com/photo.png")).toBe(true);
    expect(isImageUrl("https://example.com/a/b/diagram.jpeg")).toBe(true);
    expect(isImageUrl("https://example.com/chart.webp?v=2")).toBe(true);
    expect(isImageUrl("https://example.com/anim.gif#frag")).toBe(true);
  });

  it("does not match non-image URLs", () => {
    expect(isImageUrl("https://example.com/article")).toBe(false);
    expect(isImageUrl("https://example.com/page.html")).toBe(false);
    expect(isImageUrl("https://example.com/doc.pdf")).toBe(false);
    expect(isImageUrl("https://example.com/png-guide")).toBe(false);
  });
});

describe("fetchImage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns base64 + mime for a PNG", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(imgResponse(PNG, "image/png"));
    const result = await fetchImage("https://example.com/photo.png");
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/png");
    expect(result!.bytes).toBe(PNG.byteLength);
    expect(result!.data).toBe(Buffer.from(PNG).toString("base64"));
  });

  it("handles jpeg, gif, and webp", async () => {
    for (const [bytes, ct] of [[JPEG, "image/jpeg"], [GIF, "image/gif"], [WEBP, "image/webp"]] as const) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(imgResponse(bytes, ct));
      const result = await fetchImage("https://example.com/x");
      expect(result!.mimeType).toBe(ct);
    }
  });

  it("sniffs the type from magic bytes when the header is wrong", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(imgResponse(PNG, "application/octet-stream"));
    const result = await fetchImage("https://example.com/photo.png");
    expect(result!.mimeType).toBe("image/png");
  });

  it("rejects HTML served at an image URL (soft 404)", async () => {
    const html = new TextEncoder().encode("<!DOCTYPE html><html><body>Not found</body></html>");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(imgResponse(html, "text/html"));
    const result = await fetchImage("https://example.com/missing.png");
    expect(result).toBeNull();
  });

  it("rejects images over the size cap", async () => {
    const big = new Uint8Array(6 * 1024 * 1024);
    big.set(PNG.slice(0, 12));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(imgResponse(big, "image/png"));
    const result = await fetchImage("https://example.com/huge.png");
    expect(result).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404 }));
    expect(await fetchImage("https://example.com/x.png")).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));
    expect(await fetchImage("https://example.com/x.png")).toBeNull();
  });
});
