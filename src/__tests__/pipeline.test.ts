import { describe, it, expect, vi } from "vitest";
import { runPipeline, formatResult } from "../pipeline.js";
import type { Fetcher, FetchResult } from "../types.js";

function makeFetcher(name: string, tier: number, result: FetchResult | null): Fetcher {
  return { name, tier, fetch: vi.fn().mockResolvedValue(result) };
}

describe("runPipeline", () => {
  it("returns the first successful result above quality threshold", async () => {
    const fetchers = [
      makeFetcher("first", 1, { content: "Good content", source: "first", quality: 0.8, timing: 100 }),
      makeFetcher("second", 2, { content: "Also good", source: "second", quality: 0.9, timing: 200 }),
    ];
    const result = await runPipeline("https://example.com", fetchers);
    expect(result.result.source).toBe("first");
    expect(fetchers[1].fetch).not.toHaveBeenCalled();
  });

  it("skips failed fetchers and continues", async () => {
    const fetchers = [
      makeFetcher("failing", 1, null),
      makeFetcher("working", 2, { content: "Good content", source: "working", quality: 0.8, timing: 100 }),
    ];
    const result = await runPipeline("https://example.com", fetchers);
    expect(result.result.source).toBe("working");
  });

  it("skips low-quality results and continues", async () => {
    const fetchers = [
      makeFetcher("garbage", 1, { content: "bad", source: "garbage", quality: 0.1, timing: 50 }),
      makeFetcher("good", 2, { content: "Good content", source: "good", quality: 0.8, timing: 100 }),
    ];
    const result = await runPipeline("https://example.com", fetchers);
    expect(result.result.source).toBe("good");
  });

  it("records all attempts", async () => {
    const fetchers = [
      makeFetcher("fail1", 1, null),
      makeFetcher("fail2", 2, { content: "bad", source: "fail2", quality: 0.1, timing: 50 }),
      makeFetcher("success", 3, { content: "Good", source: "success", quality: 0.8, timing: 100 }),
    ];
    const result = await runPipeline("https://example.com", fetchers);
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts[0].status).toBe("failed");
    expect(result.attempts[1].status).toBe("failed");
    expect(result.attempts[2].status).toBe("success");
  });

  it("respects maxTier option", async () => {
    const fetchers = [
      makeFetcher("tier1", 1, null),
      makeFetcher("tier2", 2, { content: "Good", source: "tier2", quality: 0.8, timing: 100 }),
      makeFetcher("tier3", 3, { content: "Also good", source: "tier3", quality: 0.9, timing: 100 }),
    ];
    const result = await runPipeline("https://example.com", fetchers, { maxTier: 1 });
    expect(result.attempts.some(a => a.name === "tier2")).toBe(false);
  });

  it("respects custom quality threshold", async () => {
    const fetchers = [
      makeFetcher("low", 1, { content: "okay", source: "low", quality: 0.5, timing: 50 }),
      makeFetcher("high", 2, { content: "great", source: "high", quality: 0.9, timing: 100 }),
    ];
    const result = await runPipeline("https://example.com", fetchers, { qualityThreshold: 0.7 });
    expect(result.result.source).toBe("high");
  });

  it("runs tier 2 fetchers in parallel", async () => {
    const slowArchive = {
      name: "archive.ph", tier: 2,
      fetch: vi.fn().mockImplementation(() => new Promise(resolve =>
        setTimeout(() => resolve({ content: "archive content", source: "archive.ph", quality: 0.7, timing: 500 }), 50)
      )),
    } satisfies Fetcher;
    const slowWayback = {
      name: "wayback", tier: 2,
      fetch: vi.fn().mockImplementation(() => new Promise(resolve =>
        setTimeout(() => resolve({ content: "wayback content", source: "wayback", quality: 0.6, timing: 500 }), 50)
      )),
    } satisfies Fetcher;
    const fetchers: Fetcher[] = [
      makeFetcher("jina", 1, null),
      slowArchive,
      slowWayback,
      makeFetcher("raw", 3, { content: "raw", source: "raw", quality: 0.5, timing: 100 }),
    ];

    const startTime = Date.now();
    const result = await runPipeline("https://example.com", fetchers);
    const elapsed = Date.now() - startTime;

    expect(slowArchive.fetch).toHaveBeenCalled();
    expect(slowWayback.fetch).toHaveBeenCalled();
    expect(result.result.source).toBe("archive.ph");
    expect(elapsed).toBeLessThan(200);
  });

  it("prefers archive.ph as tiebreaker when both tier 2 have equal quality", async () => {
    const fetchers: Fetcher[] = [
      makeFetcher("jina", 1, null),
      makeFetcher("archive.ph", 2, { content: "archive", source: "archive.ph", quality: 0.7, timing: 100 }),
      makeFetcher("wayback", 2, { content: "wayback", source: "wayback", quality: 0.7, timing: 100 }),
    ];
    const result = await runPipeline("https://example.com", fetchers);
    expect(result.result.source).toBe("archive.ph");
  });
});

describe("formatResult", () => {
  it("formats successful result with metadata", () => {
    const output = formatResult({
      result: { content: "Article content", source: "jina", quality: 0.85, timing: 1200 },
      attempts: [{ name: "jina", status: "success", quality: 0.85, timing: 1200 }],
    });
    expect(output).toContain("Article content");
    expect(output).toContain("source: jina");
    expect(output).toContain("1.2s");
    expect(output).toContain("jina ✓");
  });

  it("formats multi-attempt result with compact trail", () => {
    const output = formatResult({
      result: { content: "Content", source: "raw", quality: 0.6, timing: 300 },
      attempts: [
        { name: "jina", status: "failed", reason: "HTTP 403" },
        { name: "archive.ph", status: "failed", reason: "not archived" },
        { name: "raw", status: "success", quality: 0.6, timing: 300 },
      ],
    });
    expect(output).toContain("source: raw");
    expect(output).toContain("jina → archive.ph → raw ✓");
  });
});
