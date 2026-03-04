import { describe, it, expect, vi, beforeEach } from "vitest";
import { arxivHandler } from "../../handlers/arxiv.js";

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <published>2017-06-12T00:00:00Z</published>
    <updated>2017-12-06T00:00:00Z</updated>
    <link href="http://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
    <link href="http://arxiv.org/pdf/1706.03762v7" title="pdf" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL"/>
    <category term="cs.CL"/>
    <category term="cs.LG"/>
  </entry>
</feed>`;

describe("arxivHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and patterns", () => {
    expect(arxivHandler.name).toBe("arxiv");
    expect(arxivHandler.patterns.some(p => p.test("https://arxiv.org/abs/1706.03762"))).toBe(true);
    expect(arxivHandler.patterns.some(p => p.test("https://arxiv.org/pdf/1706.03762"))).toBe(true);
    expect(arxivHandler.patterns.some(p => p.test("https://example.com/paper"))).toBe(false);
  });

  it("fetches paper metadata from arXiv API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_ATOM, { status: 200 })
    );

    const result = await arxivHandler.handle("https://arxiv.org/abs/1706.03762");
    expect(result).not.toBeNull();
    expect(result!.source).toBe("arxiv");
    expect(result!.content).toContain("Attention Is All You Need");
    expect(result!.content).toContain("Ashish Vaswani");
    expect(result!.content).toContain("Noam Shazeer");
    expect(result!.content).toContain("Transformer");
    expect(result!.content).toContain("cs.CL");
  });

  it("extracts arXiv ID from pdf URLs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_ATOM, { status: 200 })
    );

    const result = await arxivHandler.handle("https://arxiv.org/pdf/1706.03762");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("id_list=1706.03762"),
      expect.anything()
    );
    expect(result).not.toBeNull();
  });

  it("handles versioned arXiv IDs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_ATOM, { status: 200 })
    );

    await arxivHandler.handle("https://arxiv.org/abs/1706.03762v7");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("id_list=1706.03762"),
      expect.anything()
    );
  });

  it("returns null on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Error", { status: 500 })
    );
    const result = await arxivHandler.handle("https://arxiv.org/abs/0000.00000");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));
    const result = await arxivHandler.handle("https://arxiv.org/abs/0000.00000");
    expect(result).toBeNull();
  });
});
