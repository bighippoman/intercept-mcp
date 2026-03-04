import { describe, it, expect, vi, beforeEach } from "vitest";
import { pdfHandler, isPdfUrl } from "../../handlers/pdf.js";

describe("isPdfUrl", () => {
  it("matches .pdf URLs", () => {
    expect(isPdfUrl("https://example.com/paper.pdf")).toBe(true);
    expect(isPdfUrl("https://example.com/paper.PDF")).toBe(true);
    expect(isPdfUrl("https://example.com/paper.pdf?dl=1")).toBe(true);
  });

  it("does not match non-pdf URLs", () => {
    expect(isPdfUrl("https://example.com/article")).toBe(false);
    expect(isPdfUrl("https://example.com/pdf-viewer")).toBe(false);
  });
});

describe("pdfHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and patterns", () => {
    expect(pdfHandler.name).toBe("pdf");
    expect(pdfHandler.patterns.some(p => p.test("https://example.com/doc.pdf"))).toBe(true);
  });

  it("returns null on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );
    const result = await pdfHandler.handle("https://example.com/missing.pdf");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await pdfHandler.handle("https://example.com/error.pdf");
    expect(result).toBeNull();
  });

  it("returns fallback when extracted text is too short", async () => {
    const mockBuffer = new ArrayBuffer(10);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(mockBuffer, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    );

    const result = await pdfHandler.handle("https://example.com/scanned.pdf");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("pdf");
    expect(result!.content).toContain("example.com/scanned.pdf");
  });
});
