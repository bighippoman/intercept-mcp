import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { Handler, HandlerResult } from "../types.js";

export function isPdfUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return /\.pdf$/i.test(pathname);
  } catch {
    return false;
  }
}

export const pdfHandler: Handler = {
  name: "pdf",
  patterns: [/\.pdf(?:\?|$)/i],
  async handle(url: string): Promise<HandlerResult | null> {
    const start = Date.now();

    try {
      const response = await fetchWithTimeout(url, {}, 30_000);
      if (!response.ok) return null;

      const buffer = await response.arrayBuffer();
      let text = "";

      try {
        const pdfParse = (await import("pdf-parse")).default;
        const result = await pdfParse(Buffer.from(buffer));
        text = result.text?.trim() ?? "";
      } catch {
        // pdf-parse failed -- scanned or corrupt PDF
      }

      if (text.length < 200) {
        return {
          content: `# PDF: ${url}\n\nCould not extract meaningful text from this PDF. It may be scanned or image-based.\n\nVisit the URL directly to view the document.`,
          source: "pdf",
          timing: Date.now() - start,
        };
      }

      return {
        content: text,
        source: "pdf",
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
