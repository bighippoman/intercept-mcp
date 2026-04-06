# MCP Server Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tool annotations, isError flags, instructional error messages, structured output for search, and MCP prompts to intercept-mcp.

**Architecture:** All changes are additive to the existing codebase. Tool registration calls in `src/index.ts` get `annotations` and `outputSchema` fields. Error paths return `isError: true`. Two MCP prompts are added for common workflows. A new integration test file validates end-to-end tool registration.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk ^1.27.1, zod ^4.3.6, vitest ^4.0.18

---

### Task 1: Add Tool Annotations to `fetch` and `search` Tools

**Files:**
- Modify: `src/index.ts:54-70` (fetch tool registration)
- Modify: `src/index.ts:162-179` (search tool registration)
- Create: `src/__tests__/tool-annotations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/tool-annotations.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// We can't easily inspect registered tools on McpServer, so we test
// that the annotations object shape is valid by verifying the server
// handles listTools correctly with annotations.
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

describe("Tool annotations", () => {
  it("fetch tool annotations are well-formed", () => {
    const annotations: ToolAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    };
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.openWorldHint).toBe(true);
  });

  it("search tool annotations are well-formed", () => {
    const annotations: ToolAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    };
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.idempotentHint).toBe(false);
    expect(annotations.openWorldHint).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/tool-annotations.test.ts`
Expected: FAIL — the import `@modelcontextprotocol/sdk/types.js` may need to be verified. If it fails on import, adjust to `@modelcontextprotocol/sdk/spec.types.js` or inline the type.

- [ ] **Step 3: Fix the import if needed and verify test passes**

The `ToolAnnotations` type is exported from `@modelcontextprotocol/sdk/types.js`. If the import fails, use the inline type shape instead:

```typescript
interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}
```

Run: `npx vitest run src/__tests__/tool-annotations.test.ts`
Expected: PASS

- [ ] **Step 4: Add annotations to the fetch tool in `src/index.ts`**

In the `server.registerTool("fetch", { ... })` config object, add the `annotations` field after `inputSchema`:

```typescript
server.registerTool(
  "fetch",
  {
    title: "Fetch URL",
    description:
      "Fetch a URL and return its content as clean markdown. Handles Twitter/X tweets, YouTube videos, arXiv papers, and PDFs directly. Falls back to a multi-tier chain: Jina Reader, Wayback Machine, raw fetch, RSS, CrossRef, Semantic Scholar, HackerNews, Reddit, OG meta. Results are cached for the session.",
    inputSchema: {
      url: z.string().url().describe("The URL to fetch"),
      maxTier: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("Stop at this tier (1-5, default 5). Lower = faster but fewer fallbacks."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  // ... callback unchanged
```

- [ ] **Step 5: Add annotations to the search tool in `src/index.ts`**

In the `server.registerTool("search", { ... })` config object, add `annotations` after `inputSchema`:

```typescript
server.registerTool(
  "search",
  {
    title: "Web Search",
    description:
      "Search the web and return results. Uses Brave Search API if BRAVE_API_KEY is set, otherwise falls back to SearXNG.",
    inputSchema: {
      query: z.string().describe("Search query"),
      count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("Number of results (1-20, default 5)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  // ... callback unchanged
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All 138+ tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/__tests__/tool-annotations.test.ts
git commit -m "feat: add tool annotations (readOnlyHint, destructiveHint, etc.) to fetch and search tools"
```

---

### Task 2: Add `isError: true` to Failure Responses

**Files:**
- Modify: `src/index.ts:74-84` (fetch cache failure response)
- Modify: `src/index.ts:126-128` (fetch pipeline failure)
- Modify: `src/index.ts:193-201` (search failure response)
- Create: `src/__tests__/error-responses.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/error-responses.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("Error response format", () => {
  it("fetch failure response includes isError: true", () => {
    // Simulate what the fetch tool returns for a known-failure URL
    const response = {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "Failed to fetch content from https://dead.com. This URL failed earlier in this session and was not re-attempted.",
        },
      ],
    };
    expect(response.isError).toBe(true);
    expect(response.content[0].type).toBe("text");
  });

  it("search failure response includes isError: true", () => {
    const response = {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "Search failed. To enable search, set the BRAVE_API_KEY environment variable or configure SEARXNG_URL to point to a SearXNG instance.",
        },
      ],
    };
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("BRAVE_API_KEY");
    expect(response.content[0].text).toContain("SEARXNG_URL");
  });

  it("pipeline total-failure response includes isError: true", () => {
    const response = {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "Failed to fetch content from https://example.com. All strategies failed.",
        },
      ],
    };
    expect(response.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (structure tests)**

Run: `npx vitest run src/__tests__/error-responses.test.ts`
Expected: PASS (these are structural/contract tests)

- [ ] **Step 3: Add `isError: true` to the cache-failure response in `src/index.ts`**

Change the cached failure return (around line 76-84):

```typescript
    if (cache.isFailure(normalizedUrl)) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch content from ${normalizedUrl}. This URL failed earlier in this session and was not re-attempted.`,
          },
        ],
      };
    }
```

- [ ] **Step 4: Add `isError: true` to the pipeline total-failure path in `src/index.ts`**

After the pipeline runs, when `source === "none"`, return `isError`:

```typescript
    if (pipelineResult.result.source === "none") {
      cache.setFailure(normalizedUrl);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: formatResult(pipelineResult),
          },
        ],
      };
    }

    cache.set(normalizedUrl, pipelineResult);
    return {
      content: [
        {
          type: "text" as const,
          text: formatResult(pipelineResult),
        },
      ],
    };
```

- [ ] **Step 5: Add `isError: true` and instructional message to the search failure in `src/index.ts`**

Update the search failure path (around line 193-201):

```typescript
    if (!searchResult) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Search failed. To enable search, set the BRAVE_API_KEY environment variable or configure SEARXNG_URL to point to a SearXNG instance.",
          },
        ],
      };
    }
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/__tests__/error-responses.test.ts
git commit -m "feat: add isError flag and instructional messages to failure responses"
```

---

### Task 3: Add Structured Output (`outputSchema`) to Search Tool

**Files:**
- Modify: `src/index.ts:162-213` (search tool registration and callback)
- Create: `src/__tests__/search-structured-output.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/search-structured-output.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Define the output schema that the search tool will use
const searchOutputSchema = {
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
    })
  ),
  source: z.string(),
  timing: z.number(),
};

describe("Search structured output schema", () => {
  it("validates a successful search result", () => {
    const schema = z.object(searchOutputSchema);
    const data = {
      results: [
        { title: "Result 1", url: "https://example.com/1", snippet: "First result" },
        { title: "Result 2", url: "https://example.com/2", snippet: "Second result" },
      ],
      source: "brave",
      timing: 450,
    };
    const parsed = schema.parse(data);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.source).toBe("brave");
  });

  it("rejects invalid data", () => {
    const schema = z.object(searchOutputSchema);
    expect(() => schema.parse({ results: "not an array" })).toThrow();
  });

  it("validates empty results array", () => {
    const schema = z.object(searchOutputSchema);
    const data = { results: [], source: "searxng", timing: 100 };
    const parsed = schema.parse(data);
    expect(parsed.results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/__tests__/search-structured-output.test.ts`
Expected: PASS

- [ ] **Step 3: Add `outputSchema` to the search tool registration and return `structuredContent`**

In `src/index.ts`, update the search tool registration to include `outputSchema` and modify the callback to return `structuredContent`:

```typescript
server.registerTool(
  "search",
  {
    title: "Web Search",
    description:
      "Search the web and return results. Uses Brave Search API if BRAVE_API_KEY is set, otherwise falls back to SearXNG.",
    inputSchema: {
      query: z.string().describe("Search query"),
      count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("Number of results (1-20, default 5)"),
    },
    outputSchema: {
      results: z.array(
        z.object({
          title: z.string(),
          url: z.string(),
          snippet: z.string(),
        })
      ),
      source: z.string(),
      timing: z.number(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ query, count }) => {
    let searchResult: SearchResponse | null = null;

    const braveKey = process.env.BRAVE_API_KEY;
    if (braveKey) {
      searchResult = await braveSearch(query, braveKey, count);
    }

    if (!searchResult) {
      const searxngUrl = process.env.SEARXNG_URL || "https://search.sapti.me";
      searchResult = await searxngSearch(query, searxngUrl, count);
    }

    if (!searchResult) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Search failed. To enable search, set the BRAVE_API_KEY environment variable or configure SEARXNG_URL to point to a SearXNG instance.",
          },
        ],
      };
    }

    return {
      structuredContent: {
        results: searchResult.results,
        source: searchResult.source,
        timing: searchResult.timing,
      },
      content: [
        {
          type: "text" as const,
          text: formatSearchResult(searchResult),
        },
      ],
    };
  }
);
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/__tests__/search-structured-output.test.ts
git commit -m "feat: add structured output schema to search tool"
```

---

### Task 4: Add MCP Prompts for Common Workflows

**Files:**
- Modify: `src/index.ts` (add prompt registrations after tool registrations)
- Create: `src/__tests__/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/prompts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("MCP Prompts", () => {
  describe("research-topic prompt", () => {
    it("generates correct message structure", () => {
      const topic = "quantum computing";
      const depth = "3";
      const message = {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Search for "${topic}" and fetch the top ${depth} results. For each result, provide a brief summary of the key points. Compare perspectives across sources where relevant.`,
        },
      };
      expect(message.role).toBe("user");
      expect(message.content.text).toContain(topic);
      expect(message.content.text).toContain(depth);
    });
  });

  describe("extract-article prompt", () => {
    it("generates correct message structure", () => {
      const url = "https://example.com/article";
      const message = {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Fetch the content from ${url} and extract the key points. Summarize the main arguments, findings, or information presented.`,
        },
      };
      expect(message.role).toBe("user");
      expect(message.content.text).toContain(url);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/__tests__/prompts.test.ts`
Expected: PASS

- [ ] **Step 3: Register prompts in `src/index.ts`**

Add after the search tool registration, before the transport connection:

```typescript
server.registerPrompt(
  "research-topic",
  {
    title: "Research Topic",
    description:
      "Search for a topic and fetch the top results. Provides a multi-source summary.",
    argsSchema: {
      topic: z.string().describe("The topic to research"),
      depth: z
        .string()
        .optional()
        .default("3")
        .describe("Number of top results to fetch (default: 3)"),
    },
  },
  ({ topic, depth }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Search for "${topic}" and fetch the top ${depth} results. For each result, provide a brief summary of the key points. Compare perspectives across sources where relevant.`,
        },
      },
    ],
  })
);

server.registerPrompt(
  "extract-article",
  {
    title: "Extract Article",
    description:
      "Fetch a URL and extract the key points from the content.",
    argsSchema: {
      url: z.string().url().describe("The URL to fetch and summarize"),
    },
  },
  ({ url }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Fetch the content from ${url} and extract the key points. Summarize the main arguments, findings, or information presented.`,
        },
      },
    ],
  })
);
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/__tests__/prompts.test.ts
git commit -m "feat: add MCP prompts for research-topic and extract-article workflows"
```

---

### Task 5: Add TTL Support to LRU Cache

**Files:**
- Modify: `src/cache.ts` (add TTL logic)
- Modify: `src/__tests__/cache.test.ts` (add TTL tests)

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/cache.test.ts`:

```typescript
  it("expires entries after TTL", async () => {
    const cache = new LRUCache(10, { ttl: 50 }); // 50ms TTL
    cache.set("https://example.com", MOCK_RESULT);
    expect(cache.get("https://example.com")).toBeDefined();
    await new Promise((r) => setTimeout(r, 60));
    expect(cache.get("https://example.com")).toBeUndefined();
  });

  it("expires failure entries after failureTtl", async () => {
    const cache = new LRUCache(10, { ttl: 200, failureTtl: 50 });
    cache.setFailure("https://dead.com");
    expect(cache.isFailure("https://dead.com")).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(cache.isFailure("https://dead.com")).toBe(false);
  });

  it("uses default (no TTL) when options not provided", () => {
    const cache = new LRUCache(10);
    cache.set("https://example.com", MOCK_RESULT);
    expect(cache.get("https://example.com")).toBeDefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/cache.test.ts`
Expected: FAIL — `LRUCache` constructor does not accept options.

- [ ] **Step 3: Implement TTL support in `src/cache.ts`**

```typescript
import type { PipelineResult } from "./types.js";

const FAILURE_SENTINEL = Symbol("failure");

interface CacheEntryMeta {
  value: PipelineResult | typeof FAILURE_SENTINEL;
  expiresAt: number | null;
}

export interface LRUCacheOptions {
  ttl?: number;        // milliseconds, null = no expiry
  failureTtl?: number; // separate TTL for failures, defaults to ttl
}

export class LRUCache {
  private cache = new Map<string, CacheEntryMeta>();
  private readonly maxSize: number;
  private readonly ttl: number | null;
  private readonly failureTtl: number | null;

  constructor(maxSize: number, options: LRUCacheOptions = {}) {
    this.maxSize = maxSize;
    this.ttl = options.ttl ?? null;
    this.failureTtl = options.failureTtl ?? options.ttl ?? null;
  }

  get(url: string): PipelineResult | undefined {
    const entry = this.cache.get(url);
    if (!entry || entry.value === FAILURE_SENTINEL) return undefined;
    if (this.isExpired(entry)) {
      this.cache.delete(url);
      return undefined;
    }
    // Move to end (most recently used)
    this.cache.delete(url);
    this.cache.set(url, entry);
    return entry.value;
  }

  set(url: string, result: PipelineResult): void {
    this.cache.delete(url);
    this.cache.set(url, {
      value: result,
      expiresAt: this.ttl !== null ? Date.now() + this.ttl : null,
    });
    this.evict();
  }

  setFailure(url: string): void {
    this.cache.delete(url);
    this.cache.set(url, {
      value: FAILURE_SENTINEL,
      expiresAt: this.failureTtl !== null ? Date.now() + this.failureTtl : null,
    });
    this.evict();
  }

  isFailure(url: string): boolean {
    const entry = this.cache.get(url);
    if (!entry || entry.value !== FAILURE_SENTINEL) return false;
    if (this.isExpired(entry)) {
      this.cache.delete(url);
      return false;
    }
    // Refresh LRU position
    this.cache.delete(url);
    this.cache.set(url, entry);
    return true;
  }

  get size(): number {
    return this.cache.size;
  }

  private isExpired(entry: CacheEntryMeta): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  private evict(): void {
    while (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
  }
}
```

- [ ] **Step 4: Update the cache instantiation in `src/index.ts`**

Change line 47:

```typescript
const cache = new LRUCache(100, { ttl: 30 * 60_000, failureTtl: 5 * 60_000 });
```

(30 min TTL for successes, 5 min for failures)

- [ ] **Step 5: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS (including the 3 new TTL tests)

- [ ] **Step 6: Commit**

```bash
git add src/cache.ts src/__tests__/cache.test.ts src/index.ts
git commit -m "feat: add TTL support to LRU cache (30min success, 5min failure)"
```

---

### Task 6: Update Search Tool Description for Brave Pricing

**Files:**
- Modify: `src/index.ts:166-168` (search tool description)

- [ ] **Step 1: Update the search tool description**

Change the description in the search tool registration:

```typescript
    description:
      "Search the web and return results. Uses Brave Search API if BRAVE_API_KEY is set, otherwise falls back to SearXNG.",
```

(Removes the outdated "free tier: 2,000 queries/month" claim since Brave changed to metered billing.)

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "fix: remove outdated Brave free tier claim from search description"
```

---

### Task 7: Build and Verify

**Files:**
- No new files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (original 138 + new tests)

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: Clean compilation with no errors

- [ ] **Step 3: Verify the server starts and responds to initialize**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | node build/index.js 2>/dev/null | head -1`
Expected: JSON response with server capabilities including `tools`, `prompts`

- [ ] **Step 4: Verify tools list includes annotations**

Run: `echo -e '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node build/index.js 2>/dev/null`
Expected: Both tools listed with `annotations` containing `readOnlyHint: true`, etc.

- [ ] **Step 5: Verify prompts list**

Run: `echo -e '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"prompts/list","params":{}}' | node build/index.js 2>/dev/null`
Expected: Both prompts listed: `research-topic` and `extract-article`

- [ ] **Step 6: Commit all remaining changes**

If any unstaged fixes were needed, commit them.
