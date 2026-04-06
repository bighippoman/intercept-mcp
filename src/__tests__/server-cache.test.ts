import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LRUCache } from "../cache.js";
import { runPipeline, formatResult } from "../pipeline.js";
import { normalizeUrl } from "../normalize.js";
import type { Fetcher, PipelineResult } from "../types.js";

/**
 * Tests that exercise caching behavior through the actual MCP protocol,
 * using a minimal server with controlled fetchers.
 */

function createTestServer(fetchers: Fetcher[]) {
  const cache = new LRUCache(10, { ttl: 100, failureTtl: 50 }); // short TTLs for testing
  const server = new McpServer({ name: "test", version: "1.0.0" });

  server.registerTool(
    "fetch",
    {
      title: "Fetch",
      description: "Test fetch",
      inputSchema: {
        url: z.string().url(),
      },
    },
    async ({ url }) => {
      const normalizedUrl = normalizeUrl(url);

      if (cache.isFailure(normalizedUrl)) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `CACHED_FAILURE:${normalizedUrl}` }],
        };
      }

      const cached = cache.get(normalizedUrl);
      if (cached) {
        return {
          content: [{ type: "text" as const, text: `CACHED:${cached.result.source}:${cached.result.content}` }],
        };
      }

      const pipelineResult = await runPipeline(normalizedUrl, fetchers);

      if (pipelineResult.result.source === "none") {
        cache.setFailure(normalizedUrl);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `FAILED:${normalizedUrl}` }],
        };
      }

      cache.set(normalizedUrl, pipelineResult);
      return {
        content: [{ type: "text" as const, text: `OK:${pipelineResult.result.source}:${pipelineResult.result.content}` }],
      };
    }
  );

  return server;
}

async function connectTestServer(fetchers: Fetcher[]) {
  const server = createTestServer(fetchers);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server, cleanup: async () => { await client.close(); await server.close(); } };
}

describe("Server caching behavior (via protocol)", () => {
  it("caches successful results and returns from cache on second call", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ content: "hello world content here for quality", source: "mock", quality: 0.8, timing: 50 })
      .mockResolvedValueOnce({ content: "different", source: "mock", quality: 0.8, timing: 50 });

    const fetchers: Fetcher[] = [{ name: "mock", tier: 1, fetch: fetchFn }];
    const { client, cleanup } = await connectTestServer(fetchers);

    try {
      const r1 = await client.callTool({ name: "fetch", arguments: { url: "https://example.com" } });
      const text1 = (r1.content as Array<{ type: string; text: string }>)[0].text;
      expect(text1).toContain("OK:mock:");

      const r2 = await client.callTool({ name: "fetch", arguments: { url: "https://example.com" } });
      const text2 = (r2.content as Array<{ type: string; text: string }>)[0].text;
      expect(text2).toContain("CACHED:mock:");

      // Fetcher should only have been called once
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it("caches failures and returns isError on second call without re-fetching", async () => {
    const fetchFn = vi.fn().mockResolvedValue(null);
    const fetchers: Fetcher[] = [{ name: "always-fail", tier: 1, fetch: fetchFn }];
    const { client, cleanup } = await connectTestServer(fetchers);

    try {
      const r1 = await client.callTool({ name: "fetch", arguments: { url: "https://dead.example.com" } });
      expect(r1.isError).toBe(true);
      const text1 = (r1.content as Array<{ type: string; text: string }>)[0].text;
      expect(text1).toContain("FAILED:");

      const r2 = await client.callTool({ name: "fetch", arguments: { url: "https://dead.example.com" } });
      expect(r2.isError).toBe(true);
      const text2 = (r2.content as Array<{ type: string; text: string }>)[0].text;
      expect(text2).toContain("CACHED_FAILURE:");

      // Fetcher called once (first attempt), not again for cached failure
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it("failure cache expires after failureTtl, allowing retry", async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return null; // fail first time
      return { content: "recovered content for quality scoring", source: "mock", quality: 0.8, timing: 50 };
    });

    const fetchers: Fetcher[] = [{ name: "mock", tier: 1, fetch: fetchFn }];
    const { client, cleanup } = await connectTestServer(fetchers);

    try {
      // First call: fails
      const r1 = await client.callTool({ name: "fetch", arguments: { url: "https://retry.example.com" } });
      expect(r1.isError).toBe(true);

      // Second call immediately: cached failure
      const r2 = await client.callTool({ name: "fetch", arguments: { url: "https://retry.example.com" } });
      expect(r2.isError).toBe(true);
      expect(fetchFn).toHaveBeenCalledTimes(1); // still only 1 real call

      // Wait for failureTtl to expire (50ms + buffer)
      await new Promise((r) => setTimeout(r, 70));

      // Third call: should retry and succeed
      const r3 = await client.callTool({ name: "fetch", arguments: { url: "https://retry.example.com" } });
      expect(r3.isError).toBeFalsy();
      const text3 = (r3.content as Array<{ type: string; text: string }>)[0].text;
      expect(text3).toContain("OK:mock:");
      expect(fetchFn).toHaveBeenCalledTimes(2); // now 2 real calls
    } finally {
      await cleanup();
    }
  });

  it("normalizes URLs before caching — same URL with tracking params hits cache", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValue({ content: "good content for quality scoring tests", source: "mock", quality: 0.8, timing: 50 });

    const fetchers: Fetcher[] = [{ name: "mock", tier: 1, fetch: fetchFn }];
    const { client, cleanup } = await connectTestServer(fetchers);

    try {
      await client.callTool({ name: "fetch", arguments: { url: "https://example.com/page?utm_source=twitter" } });
      const r2 = await client.callTool({ name: "fetch", arguments: { url: "https://example.com/page?utm_medium=social" } });
      const text2 = (r2.content as Array<{ type: string; text: string }>)[0].text;
      expect(text2).toContain("CACHED:");

      // Only one real fetch — both URLs normalize to https://example.com/page
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it("success cache expires after ttl, allowing re-fetch", async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      callCount++;
      return { content: `version ${callCount} content for quality`, source: "mock", quality: 0.8, timing: 50 };
    });

    const fetchers: Fetcher[] = [{ name: "mock", tier: 1, fetch: fetchFn }];
    const { client, cleanup } = await connectTestServer(fetchers);

    try {
      const r1 = await client.callTool({ name: "fetch", arguments: { url: "https://ttl-test.example.com" } });
      expect((r1.content as Array<{ type: string; text: string }>)[0].text).toContain("OK:mock:version 1");

      // Cached
      const r2 = await client.callTool({ name: "fetch", arguments: { url: "https://ttl-test.example.com" } });
      expect((r2.content as Array<{ type: string; text: string }>)[0].text).toContain("CACHED:mock:");

      // Wait for ttl to expire (100ms + buffer)
      await new Promise((r) => setTimeout(r, 120));

      // Re-fetch
      const r3 = await client.callTool({ name: "fetch", arguments: { url: "https://ttl-test.example.com" } });
      expect((r3.content as Array<{ type: string; text: string }>)[0].text).toContain("OK:mock:version 2");
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      await cleanup();
    }
  });
});
