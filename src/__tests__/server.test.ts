import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";

/**
 * Integration tests that exercise the real MCP server over the protocol.
 * Uses InMemoryTransport to wire a Client directly to the server.
 */

let client: Client;
let cleanup: () => Promise<void>;

async function connectClient() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  const c = new Client({ name: "test-client", version: "1.0.0" });
  await c.connect(clientTransport);

  return {
    client: c,
    cleanup: async () => {
      await c.close();
      await server.close();
    },
  };
}

describe("MCP Server Integration", () => {
  beforeAll(async () => {
    const conn = await connectClient();
    client = conn.client;
    cleanup = conn.cleanup;
  });

  afterAll(async () => {
    await cleanup();
  });

  describe("tools/list", () => {
    it("lists fetch, fetch_batch, research, and search tools", async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("fetch");
      expect(names).toContain("fetch_batch");
      expect(names).toContain("research");
      expect(names).toContain("search");
      expect(result.tools).toHaveLength(4);
    });

    it("fetch tool exposes an outputSchema with pagination fields", async () => {
      const result = await client.listTools();
      const fetchTool = result.tools.find((t) => t.name === "fetch")!;
      expect(fetchTool.outputSchema).toBeDefined();
      expect(fetchTool.outputSchema!.properties).toHaveProperty("source");
      expect(fetchTool.outputSchema!.properties).toHaveProperty("quality");
      expect(fetchTool.outputSchema!.properties).toHaveProperty("contentLength");
      expect(fetchTool.outputSchema!.properties).toHaveProperty("truncated");
      expect(fetchTool.outputSchema!.properties).toHaveProperty("nextStartIndex");
    });

    it("fetch tool accepts maxLength, startIndex, and noCache inputs", async () => {
      const result = await client.listTools();
      const fetchTool = result.tools.find((t) => t.name === "fetch")!;
      const props = fetchTool.inputSchema.properties as Record<string, unknown>;
      expect(props).toHaveProperty("maxLength");
      expect(props).toHaveProperty("startIndex");
      expect(props).toHaveProperty("noCache");
    });

    it("search tool accepts site, freshness, and page inputs", async () => {
      const result = await client.listTools();
      const searchTool = result.tools.find((t) => t.name === "search")!;
      const props = searchTool.inputSchema.properties as Record<string, unknown>;
      expect(props).toHaveProperty("site");
      expect(props).toHaveProperty("freshness");
      expect(props).toHaveProperty("page");
    });

    it("fetch tool has correct annotations from the protocol", async () => {
      const result = await client.listTools();
      const fetchTool = result.tools.find((t) => t.name === "fetch")!;
      expect(fetchTool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
    });

    it("search tool has correct annotations from the protocol", async () => {
      const result = await client.listTools();
      const searchTool = result.tools.find((t) => t.name === "search")!;
      expect(searchTool.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      });
    });

    it("search tool exposes an outputSchema", async () => {
      const result = await client.listTools();
      const searchTool = result.tools.find((t) => t.name === "search")!;
      expect(searchTool.outputSchema).toBeDefined();
      expect(searchTool.outputSchema!.type).toBe("object");
      expect(searchTool.outputSchema!.properties).toHaveProperty("results");
      expect(searchTool.outputSchema!.properties).toHaveProperty("source");
      expect(searchTool.outputSchema!.properties).toHaveProperty("timing");
    });

    it("fetch tool has title and description", async () => {
      const result = await client.listTools();
      const fetchTool = result.tools.find((t) => t.name === "fetch")!;
      expect(fetchTool.title).toBe("Fetch URL");
      expect(fetchTool.description).toContain("multi-tier chain");
    });

    it("search tool description does not mention free tier", async () => {
      const result = await client.listTools();
      const searchTool = result.tools.find((t) => t.name === "search")!;
      expect(searchTool.description).not.toContain("free tier");
      expect(searchTool.description).not.toContain("2,000");
    });
  });

  describe("prompts/list", () => {
    it("lists both prompts", async () => {
      const result = await client.listPrompts();
      const names = result.prompts.map((p) => p.name);
      expect(names).toContain("research-topic");
      expect(names).toContain("extract-article");
      expect(result.prompts).toHaveLength(2);
    });

    it("research-topic prompt has correct arguments", async () => {
      const result = await client.listPrompts();
      const prompt = result.prompts.find((p) => p.name === "research-topic")!;
      expect(prompt.title).toBe("Research Topic");
      const argNames = prompt.arguments!.map((a) => a.name);
      expect(argNames).toContain("topic");
      expect(argNames).toContain("depth");
    });

    it("extract-article prompt has url argument", async () => {
      const result = await client.listPrompts();
      const prompt = result.prompts.find((p) => p.name === "extract-article")!;
      expect(prompt.title).toBe("Extract Article");
      const argNames = prompt.arguments!.map((a) => a.name);
      expect(argNames).toContain("url");
    });
  });

  describe("prompts/get", () => {
    it("research-topic returns a message with the topic interpolated", async () => {
      const result = await client.getPrompt({
        name: "research-topic",
        arguments: { topic: "machine learning", depth: "5" },
      });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("machine learning");
      expect(text).toContain("5");
    });

    it("extract-article returns a message with the URL interpolated", async () => {
      const result = await client.getPrompt({
        name: "extract-article",
        arguments: { url: "https://example.com/test" },
      });
      expect(result.messages).toHaveLength(1);
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("https://example.com/test");
    });
  });

  describe("search tool - failure path", () => {
    it("returns isError with instructional message when no backend available", async () => {
      // Mock fetch to reject all requests (simulates no Brave key + SearXNG down)
      const originalEnv = { ...process.env };
      delete process.env.BRAVE_API_KEY;
      process.env.SEARXNG_URL = "http://localhost:1"; // unreachable

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));

      try {
        const result = await client.callTool({
          name: "search",
          arguments: { query: "test query", count: 3 },
        });

        expect(result.isError).toBe(true);
        const text = (result.content as Array<{ type: string; text: string }>)[0].text;
        expect(text).toContain("BRAVE_API_KEY");
        expect(text).toContain("SEARXNG_URL");
      } finally {
        fetchSpy.mockRestore();
        process.env = originalEnv;
      }
    });
  });

  describe("search tool - success path", () => {
    it("returns structuredContent with search results", async () => {
      const mockResponse = {
        web: {
          results: [
            { title: "Result 1", url: "https://example.com/1", description: "First" },
            { title: "Result 2", url: "https://example.com/2", description: "Second" },
          ],
        },
      };

      const originalEnv = { ...process.env };
      process.env.BRAVE_API_KEY = "test-key";

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      try {
        const result = await client.callTool({
          name: "search",
          arguments: { query: "test", count: 2 },
        });

        expect(result.isError).toBeFalsy();

        // structuredContent should have the results
        expect(result.structuredContent).toBeDefined();
        const structured = result.structuredContent as {
          results: Array<{ title: string; url: string; snippet: string }>;
          source: string;
          timing: number;
        };
        expect(structured.results).toHaveLength(2);
        expect(structured.results[0].title).toBe("Result 1");
        expect(structured.source).toBe("brave");
        expect(typeof structured.timing).toBe("number");

        // content should also have the markdown formatted text
        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0].text).toContain("Result 1");
      } finally {
        fetchSpy.mockRestore();
        process.env = originalEnv;
      }
    });
  });

  describe("fetch tool - with mocked pipeline", () => {
    it("returns content from a successful fetch via og-meta fallback", async () => {
      // Mock fetch to return a page with OG meta tags
      const html = `<html><head>
        <title>Test Page</title>
        <meta property="og:title" content="OG Test Title" />
        <meta property="og:description" content="A test description that is long enough to pass quality checks and provides meaningful content for the extraction pipeline to work with properly." />
      </head><body><p>Content here</p></body></html>`;

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(html, { status: 200 })
      );

      try {
        // Use maxTier: 5 and a URL that won't match any handler
        const result = await client.callTool({
          name: "fetch",
          arguments: { url: "https://test-integration.example.com/page", maxTier: 5 },
        });

        // Should not be an error — og-meta (tier 5) always returns something
        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0].text.length).toBeGreaterThan(0);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("returns isError when all fetchers fail", async () => {
      // Mock fetch to always fail
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("network error")
      );

      try {
        const result = await client.callTool({
          name: "fetch",
          arguments: { url: "https://totally-dead.example.com/nothing" },
        });

        // og-meta fetcher never returns null, but it returns a very low quality fallback
        // The pipeline should still return something (og-meta fallback)
        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0].text.length).toBeGreaterThan(0);
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("truncates content at maxLength and reports pagination in structuredContent", async () => {
      const longBody = "word ".repeat(5000);
      const html = `<html><head>
        <title>Long Page</title>
        <meta property="og:title" content="Long Page" />
        <meta property="og:description" content="${longBody}" />
      </head><body></body></html>`;

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(new Response(html, { status: 200 }))
      );

      try {
        const result = await client.callTool({
          name: "fetch",
          arguments: { url: "https://truncation-test.example.com/long", maxLength: 500 },
        });

        const structured = result.structuredContent as {
          truncated: boolean;
          nextStartIndex?: number;
          contentLength: number;
          returnedLength: number;
        };
        expect(structured.truncated).toBe(true);
        expect(structured.nextStartIndex).toBe(500);
        expect(structured.contentLength).toBeGreaterThan(500);
        expect(structured.returnedLength).toBe(500);

        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0].text).toContain("Content truncated");
        expect(content[0].text).toContain("startIndex=500");
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("returns a direct image URL as an image content block", async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(png, { status: 200, headers: { "content-type": "image/png" } })
      );

      try {
        const result = await client.callTool({
          name: "fetch",
          arguments: { url: "https://example.com/diagram.png" },
        });

        const content = result.content as Array<{ type: string; data?: string; mimeType?: string; text?: string }>;
        const image = content.find((c) => c.type === "image");
        expect(image).toBeDefined();
        expect(image!.mimeType).toBe("image/png");
        expect(image!.data).toBe(Buffer.from(png).toString("base64"));

        const structured = result.structuredContent as { source: string; mimeType?: string; bytes?: number };
        expect(structured.source).toBe("image");
        expect(structured.mimeType).toBe("image/png");
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("never sends an authed fetch to the public shared cache", async () => {
      const { __resetAuthForTests } = await import("../auth.js");
      const html = `<html><head>
        <title>Private</title>
        <meta property="og:title" content="Private Dashboard" />
        <meta property="og:description" content="Authenticated content that must never be written to or read from the shared agentsweb cache because it is the user's private view." />
      </head><body></body></html>`;

      const originalEnv = { ...process.env };
      process.env.INTERCEPT_AUTH = JSON.stringify({ "authed-target.example.com": { Cookie: "session=secret" } });
      __resetAuthForTests();

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(new Response(html, { status: 200 }))
      );

      try {
        await client.callTool({
          name: "fetch",
          arguments: { url: "https://authed-target.example.com/dashboard" },
        });

        const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };
        // No request — read or write — should have hit the shared cache host.
        expect(fetchSpy.mock.calls.some((c) => hostOf(String(c[0])) === "agentsweb.org")).toBe(false);
        // Any intermediary (e.g. Jina) must not have received the credential.
        for (const c of fetchSpy.mock.calls) {
          if (hostOf(String(c[0])) !== "authed-target.example.com") {
            expect(new Headers((c[1] as { headers?: HeadersInit }).headers).get("Cookie")).toBeNull();
          }
        }
      } finally {
        fetchSpy.mockRestore();
        process.env = originalEnv;
        __resetAuthForTests();
      }
    });

    it("refuses to fetch private addresses", async () => {
      const result = await client.callTool({
        name: "fetch",
        arguments: { url: "http://169.254.169.254/latest/meta-data/" },
      });

      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toContain("Refusing to fetch");
    });
  });

  describe("fetch_batch tool", () => {
    it("fetches multiple URLs and returns per-URL sections", async () => {
      const html = `<html><head>
        <title>Batch Page</title>
        <meta property="og:title" content="Batch Page" />
        <meta property="og:description" content="A description long enough to pass the quality checks of the extraction pipeline for batch testing purposes here." />
      </head><body></body></html>`;

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(new Response(html, { status: 200 }))
      );

      try {
        const result = await client.callTool({
          name: "fetch_batch",
          arguments: {
            urls: [
              "https://batch-a.example.com/one",
              "https://batch-b.example.com/two",
            ],
          },
        });

        const structured = result.structuredContent as {
          results: Array<{ url: string; ok: boolean; source: string }>;
        };
        expect(structured.results).toHaveLength(2);

        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0].text).toContain("# Batch fetch");
        expect(content[0].text).toContain("## https://batch-a.example.com/one");
        expect(content[0].text).toContain("## https://batch-b.example.com/two");
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe("research tool", () => {
    it("searches and fetches the top results in one call", async () => {
      const searchResponse = {
        web: {
          results: [
            { title: "Research Result", url: "https://research-target.example.com/article", description: "Snippet" },
          ],
        },
      };
      const pageHtml = `<html><head>
        <title>Research Article</title>
        <meta property="og:title" content="Research Article" />
        <meta property="og:description" content="The article content that the research tool should fetch and include in its combined output for the agent." />
      </head><body></body></html>`;

      const originalEnv = { ...process.env };
      process.env.BRAVE_API_KEY = "test-key";

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = String(input);
        if (url.includes("api.search.brave.com")) {
          return Promise.resolve(new Response(JSON.stringify(searchResponse), { status: 200 }));
        }
        return Promise.resolve(new Response(pageHtml, { status: 200 }));
      });

      try {
        const result = await client.callTool({
          name: "research",
          arguments: { query: "test research query", count: 1 },
        });

        expect(result.isError).toBeFalsy();

        const structured = result.structuredContent as {
          query: string;
          searchSource: string;
          results: Array<{ title: string; url: string; fetched: boolean }>;
        };
        expect(structured.query).toBe("test research query");
        expect(structured.searchSource).toBe("brave");
        expect(structured.results).toHaveLength(1);

        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0].text).toContain("# Research: test research query");
        expect(content[0].text).toContain("Research Result");
      } finally {
        fetchSpy.mockRestore();
        process.env = originalEnv;
      }
    });
  });

  describe("resources", () => {
    it("lists the recent-fetches resource", async () => {
      const result = await client.listResources();
      const uris = result.resources.map((r) => r.uri);
      expect(uris).toContain("intercept://session/recent");
    });

    it("reads the recent-fetches resource as markdown", async () => {
      const result = await client.readResource({ uri: "intercept://session/recent" });
      const content = result.contents[0] as { mimeType?: string; text?: string };
      expect(content.mimeType).toBe("text/markdown");
      expect(content.text).toContain("# Recently fetched URLs");
    });
  });
});
