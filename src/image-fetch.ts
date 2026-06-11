import { fetchWithTimeout } from "./fetch-with-timeout.js";

/**
 * Vision fallback: some "pages" are fundamentally visual — a direct image URL,
 * a chart, a scanned document, an infographic — with no text to extract. MCP
 * supports image content blocks, so rather than returning a useless stub we
 * hand the image to the agent's own vision model to read.
 *
 * Scoped to direct image URLs (by extension) with a size cap, and limited to
 * the image types MCP clients can render.
 */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)(?:$|[?#])/i;
const SUPPORTED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024; // vision models reject very large images

export interface ImageResult {
  data: string; // base64
  mimeType: string;
  bytes: number;
}

export function isImageUrl(url: string): boolean {
  try {
    return IMAGE_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Identify the image type from magic bytes, independent of the URL/header. */
function sniffMime(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export async function fetchImage(url: string): Promise<ImageResult | null> {
  try {
    const response = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5",
        },
      },
      15_000,
    );
    if (!response.ok) return null;

    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;

    const headerType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    // Trust the header only if it's a supported type; otherwise sniff. This
    // also rejects HTML/error pages served at an image-looking URL.
    const mimeType = SUPPORTED.has(headerType) ? headerType : sniffMime(buf);
    if (!mimeType || !SUPPORTED.has(mimeType)) return null;

    return {
      data: Buffer.from(buf).toString("base64"),
      mimeType,
      bytes: buf.byteLength,
    };
  } catch {
    return null;
  }
}
