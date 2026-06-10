import { describe, it, expect, vi, beforeEach } from "vitest";
import { markdownEndpointFetcher } from "../../fetchers/markdown-endpoint.js";

const MD = `# Guide\n\nThis is a real markdown document with several sentences of content. ${"More body text here. ".repeat(20)}\n\n- one\n- two\n`;

function mdResponse(body: string, contentType = "text/markdown") {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

describe("markdownEndpointFetcher", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("has the expected name and tier", () => {
    expect(markdownEndpointFetcher.name).toBe("markdown-endpoint");
    expect(markdownEndpointFetcher.tier).toBe(3);
  });

  it("requests the .md variant of the path", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const u = String(input);
      if (u.endsWith("/docs/guide.md")) return Promise.resolve(mdResponse(MD));
      return Promise.resolve(new Response("nope", { status: 404 }));
    });

    const result = await markdownEndpointFetcher.fetch("https://example.com/docs/guide");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("markdown-endpoint");
    expect(result!.content).toContain("# Guide");
    expect(spy).toHaveBeenCalledWith("https://example.com/docs/guide.md", expect.anything());
  });

  it("accepts content-negotiated markdown on the original URL", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const u = String(input);
      if (u === "https://example.com/page") return Promise.resolve(mdResponse(MD));
      return Promise.resolve(new Response("nope", { status: 404 }));
    });

    const result = await markdownEndpointFetcher.fetch("https://example.com/page");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("real markdown document");
  });

  it("rejects HTML served at the .md URL (soft 404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<!DOCTYPE html><html><body>Not found</body></html>", { status: 200, headers: { "content-type": "text/html" } })
    );
    const result = await markdownEndpointFetcher.fetch("https://example.com/docs/guide");
    expect(result).toBeNull();
  });

  it("rejects text/plain that does not look like markdown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mdResponse("just a flat sentence of plain text with no markdown structure at all here okay", "text/plain")
    );
    const result = await markdownEndpointFetcher.fetch("https://example.com/page");
    expect(result).toBeNull();
  });

  it("accepts text/plain that does look like markdown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mdResponse(MD, "text/plain"));
    const result = await markdownEndpointFetcher.fetch("https://example.com/page");
    expect(result).not.toBeNull();
  });

  it("does not append .md to URLs that already have an extension", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 404 }));
    await markdownEndpointFetcher.fetch("https://example.com/file.pdf");
    for (const call of spy.mock.calls) {
      expect(String(call[0])).not.toContain(".pdf.md");
    }
  });

  it("skips the .md variant when the URL has a query string", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x", { status: 404 }));
    await markdownEndpointFetcher.fetch("https://example.com/search?q=test");
    expect(spy).toHaveBeenCalledTimes(1); // only the Accept-negotiated original
  });

  it("returns null when nothing yields markdown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not Found", { status: 404 }));
    const result = await markdownEndpointFetcher.fetch("https://example.com/docs/guide");
    expect(result).toBeNull();
  });
});
