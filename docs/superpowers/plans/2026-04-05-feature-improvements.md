# Feature Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Markdown output, Cloudflare Browser Rendering, GitHub/Wikipedia handlers, YouTube transcripts, and DuckDuckGo search to intercept-mcp.

**Architecture:** Each feature is an independent module following existing patterns (Fetcher/Handler/Search interfaces). Turndown goes first because later features depend on `htmlToMarkdown()`. The CF fetcher, handlers, and search backend are self-contained additions registered in `server.ts`.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, turndown + @truto/turndown-plugin-gfm, youtube-transcript, duck-duck-scrape, vitest

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install production dependencies**

```bash
npm install turndown @truto/turndown-plugin-gfm youtube-transcript duck-duck-scrape
```

- [ ] **Step 2: Install type definitions**

```bash
npm install -D @types/turndown
```

- [ ] **Step 3: Verify build still works**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 4: Run existing tests**

Run: `npx vitest run`
Expected: All 261 tests pass

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add turndown, youtube-transcript, duck-duck-scrape dependencies"
```

---

### Task 2: Turndown — HTML to Markdown conversion

**Files:**
- Modify: `src/html.ts`
- Test: `src/__tests__/html.test.ts`

- [ ] **Step 1: Add `htmlToMarkdown()` to `src/html.ts`**

Add this function after the existing `htmlToText()` function (do NOT remove `htmlToText` — it's still used by tests and the RSS fetcher's internal feed parsing):

```typescript
import TurndownService from "turndown";
import { gfm } from "@truto/turndown-plugin-gfm";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
turndown.use(gfm);

export function htmlToMarkdown(html: string): string {
  if (!html) return "";

  // Try Readability first — it returns article.content as clean HTML
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();
    if (article?.content) {
      const md = turndown.turndown(article.content).trim();
      if (md.length >= 200) return md;
    }
  } catch { /* fall through to regex + turndown */ }

  // Regex fallback: strip noise, then convert remaining HTML to Markdown
  let text = html;
  const articleMatch = text.match(/<article[\s>][\s\S]*?<\/article>/i)
    ?? text.match(/<main[\s>][\s\S]*?<\/main>/i);
  if (articleMatch) text = articleMatch[0];

  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, "");

  try {
    return turndown.turndown(text).trim();
  } catch {
    return htmlToText(html);
  }
}
```

Note: The imports for `TurndownService` and `gfm` go at the top of the file alongside the existing `Readability` and `parseHTML` imports. The `turndown` instance is module-level (created once, reused).

- [ ] **Step 2: Add tests for `htmlToMarkdown` in `src/__tests__/html.test.ts`**

Add a new `describe("htmlToMarkdown")` block at the end of the existing test file:

```typescript
import { htmlToMarkdown } from "../html.js";

describe("htmlToMarkdown", () => {
  it("converts headings to atx-style markdown", () => {
    const html = "<html><body><h1>Title</h1><h2>Subtitle</h2><p>Content that is long enough to pass the two hundred character minimum threshold for Readability extraction and quality scoring so we get a proper result back.</p></body></html>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Title");
    expect(md).toContain("## Subtitle");
  });

  it("preserves links as markdown links", () => {
    const html = `<html><body><article><p>Visit <a href="https://example.com">Example</a> for more. ${"Content padding. ".repeat(20)}</p></article></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("[Example](https://example.com)");
  });

  it("preserves bold and italic", () => {
    const html = `<html><body><article><p><strong>Bold text</strong> and <em>italic text</em>. ${"Padding content. ".repeat(20)}</p></article></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("**Bold text**");
    expect(md).toContain("*italic text*");
  });

  it("converts code blocks to fenced style", () => {
    const html = `<html><body><article><pre><code>const x = 1;</code></pre><p>${"Padding. ".repeat(30)}</p></article></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("```");
    expect(md).toContain("const x = 1;");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });

  it("falls back to regex+turndown when Readability fails", () => {
    const html = `<nav>Skip</nav><main><p>Main content here ${"with padding. ".repeat(20)}</p></main><footer>Skip</footer>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("Main content");
    expect(md).not.toContain("Skip");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/__tests__/html.test.ts`
Expected: All existing tests + 6 new tests pass

- [ ] **Step 4: Update fetchers to use `htmlToMarkdown` instead of `htmlToText`**

In each of these files, change the import and the function call:

**`src/fetchers/raw.ts`:** Change `import { htmlToText } from "../html.js"` to `import { htmlToMarkdown } from "../html.js"` and change `htmlToText(html)` to `htmlToMarkdown(html)`.

**`src/fetchers/wayback.ts`:** Same change — `htmlToText` → `htmlToMarkdown` in import and usage.

**`src/fetchers/codetabs.ts`:** Same change.

**`src/fetchers/rss.ts`:** This file uses `htmlToText` for cleaning feed item content (which is often HTML snippets). Change the import to `import { htmlToText, htmlToMarkdown } from "../html.js"` and change only the call on line 21 (`htmlToText(content)` inside `extractItemsFromFeed`) to `htmlToMarkdown(content)`. Keep `htmlToText` available if any other usage exists.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/html.ts src/__tests__/html.test.ts src/fetchers/raw.ts src/fetchers/wayback.ts src/fetchers/codetabs.ts src/fetchers/rss.ts
git commit -m "feat: add htmlToMarkdown using Turndown, switch fetchers to Markdown output"
```

---

### Task 3: Cloudflare Browser Rendering fetcher

**Files:**
- Create: `src/fetchers/cloudflare.ts`
- Create: `src/__tests__/fetchers/cloudflare.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Create `src/fetchers/cloudflare.ts`**

```typescript
import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

export const cloudflareFetcher: Fetcher = {
  name: "cloudflare",
  tier: 1,
  async fetch(url: string): Promise<FetchResult | null> {
    const accountId = process.env.CF_ACCOUNT_ID;
    const apiToken = process.env.CF_API_TOKEN;
    if (!accountId || !apiToken) return null;

    const start = Date.now();
    try {
      const response = await fetchWithTimeout(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/markdown`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            gotoOptions: { waitUntil: "networkidle0" },
            rejectResourceTypes: ["image", "font", "media", "stylesheet"],
          }),
        },
        15_000
      );

      if (!response.ok) return null;

      const data = (await response.json()) as { success: boolean; result?: string };
      if (!data.success || !data.result) return null;

      return {
        content: data.result,
        source: "cloudflare",
        quality: scoreContent(data.result),
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
```

- [ ] **Step 2: Create `src/__tests__/fetchers/cloudflare.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cloudflareFetcher } from "../../fetchers/cloudflare.js";

describe("cloudflareFetcher", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("has correct name and tier", () => {
    expect(cloudflareFetcher.name).toBe("cloudflare");
    expect(cloudflareFetcher.tier).toBe(1);
  });

  it("returns null when env vars are not set", async () => {
    delete process.env.CF_ACCOUNT_ID;
    delete process.env.CF_API_TOKEN;
    const result = await cloudflareFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  });

  it("returns markdown content on success", async () => {
    process.env.CF_ACCOUNT_ID = "test-account";
    process.env.CF_API_TOKEN = "test-token";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        success: true,
        result: "# Example\n\nThis is example content that is long enough to pass quality scoring thresholds for the test to work properly and verify markdown extraction.",
      }), { status: 200 })
    );

    const result = await cloudflareFetcher.fetch("https://example.com");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("# Example");
    expect(result!.source).toBe("cloudflare");
    expect(result!.quality).toBeGreaterThan(0);
  });

  it("sends correct request to CF API", async () => {
    process.env.CF_ACCOUNT_ID = "my-account";
    process.env.CF_API_TOKEN = "my-token";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, result: "# Content\n\n" + "x".repeat(300) }), { status: 200 })
    );

    await cloudflareFetcher.fetch("https://example.com");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/my-account/browser-rendering/markdown",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer my-token",
        }),
      }),
      expect.anything()
    );
  });

  it("returns null on API error", async () => {
    process.env.CF_ACCOUNT_ID = "test-account";
    process.env.CF_API_TOKEN = "test-token";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    const result = await cloudflareFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    process.env.CF_ACCOUNT_ID = "test-account";
    process.env.CF_API_TOKEN = "test-token";

    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));

    const result = await cloudflareFetcher.fetch("https://example.com");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Register in `src/server.ts`**

Add import at the top with the other fetcher imports:
```typescript
import { cloudflareFetcher } from "./fetchers/cloudflare.js";
```

Add `cloudflareFetcher` as the FIRST entry in the `FETCHERS` array (before `jinaFetcher`):
```typescript
const FETCHERS: Fetcher[] = [
  cloudflareFetcher,
  jinaFetcher,
  waybackFetcher,
  // ... rest unchanged
];
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/fetchers/cloudflare.ts src/__tests__/fetchers/cloudflare.test.ts src/server.ts
git commit -m "feat: add Cloudflare Browser Rendering fetcher (tier 1, JS rendering, markdown)"
```

---

### Task 4: GitHub handler

**Files:**
- Create: `src/handlers/github.ts`
- Create: `src/__tests__/handlers/github.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Create `src/handlers/github.ts`**

```typescript
import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { Handler, HandlerResult } from "../types.js";

function extractRepoPath(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+?)\/?$/);
  if (!match) return null;
  // Exclude non-repo paths
  const reserved = ["settings", "marketplace", "explore", "topics", "trending", "collections", "sponsors", "login", "join"];
  if (reserved.includes(match[1])) return null;
  return { owner: match[1], repo: match[2] };
}

const BRANCHES = ["HEAD", "main", "master"];

export const githubHandler: Handler = {
  name: "github",
  patterns: [/github\.com\/[^\/]+\/[^\/]+\/?$/],
  async handle(url: string): Promise<HandlerResult | null> {
    const start = Date.now();
    const parsed = extractRepoPath(url);
    if (!parsed) return null;

    const { owner, repo } = parsed;

    for (const branch of BRANCHES) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
        const response = await fetchWithTimeout(rawUrl, {}, 8_000);
        if (!response.ok) continue;
        const content = await response.text();
        if (content.length < 50) continue;

        return {
          content: `# ${owner}/${repo}\n\n${content}`,
          source: "github",
          timing: Date.now() - start,
        };
      } catch {
        continue;
      }
    }

    return null;
  },
};
```

- [ ] **Step 2: Create `src/__tests__/handlers/github.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { githubHandler } from "../../handlers/github.js";

describe("githubHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and patterns", () => {
    expect(githubHandler.name).toBe("github");
    expect(githubHandler.patterns[0].test("https://github.com/nodejs/node")).toBe(true);
    expect(githubHandler.patterns[0].test("https://github.com/nodejs/node/")).toBe(true);
  });

  it("does not match non-repo URLs", () => {
    expect(githubHandler.patterns[0].test("https://github.com/nodejs/node/blob/main/README.md")).toBe(false);
    expect(githubHandler.patterns[0].test("https://github.com/nodejs/node/issues")).toBe(false);
  });

  it("returns null for non-github URL", async () => {
    const result = await githubHandler.handle("https://example.com");
    expect(result).toBeNull();
  });

  it("fetches README content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("# My Project\n\nA cool project.", { status: 200 })
    );

    const result = await githubHandler.handle("https://github.com/owner/repo");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("owner/repo");
    expect(result!.content).toContain("My Project");
    expect(result!.source).toBe("github");
  });

  it("tries multiple branches on 404", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 })) // HEAD
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 })) // main
      .mockResolvedValueOnce(new Response("# Readme\n\nContent here for the test.", { status: 200 })); // master

    const result = await githubHandler.handle("https://github.com/owner/repo");
    expect(result).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 3: Register in `src/server.ts`**

Add import:
```typescript
import { githubHandler } from "./handlers/github.js";
```

Add to `HANDLERS` array (after `pdfHandler`):
```typescript
const HANDLERS: Handler[] = [
  twitterHandler,
  youtubeHandler,
  arxivHandler,
  pdfHandler,
  githubHandler,
];
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/handlers/github.ts src/__tests__/handlers/github.test.ts src/server.ts
git commit -m "feat: add GitHub handler for direct README.md extraction"
```

---

### Task 5: Wikipedia handler

**Files:**
- Create: `src/handlers/wikipedia.ts`
- Create: `src/__tests__/handlers/wikipedia.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Create `src/handlers/wikipedia.ts`**

```typescript
import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { htmlToMarkdown } from "../html.js";
import type { Handler, HandlerResult } from "../types.js";

function extractWikiTitle(url: string): { lang: string; title: string } | null {
  const match = url.match(/([a-z]{2,3})\.wikipedia\.org\/wiki\/(.+)/);
  if (!match) return null;
  return { lang: match[1], title: decodeURIComponent(match[2]).replace(/#.*$/, "") };
}

export const wikipediaHandler: Handler = {
  name: "wikipedia",
  patterns: [/[a-z]{2,3}\.wikipedia\.org\/wiki\/.+/],
  async handle(url: string): Promise<HandlerResult | null> {
    const start = Date.now();
    const parsed = extractWikiTitle(url);
    if (!parsed) return null;

    const { lang, title } = parsed;

    try {
      // Try full article HTML first (best quality with Turndown)
      const htmlUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`;
      const response = await fetchWithTimeout(htmlUrl, {
        headers: {
          "User-Agent": "intercept-mcp/3.0.0 (https://github.com/bighippoman/intercept-mcp)",
          Accept: "text/html",
        },
      });

      if (response.ok) {
        const html = await response.text();
        const markdown = htmlToMarkdown(html);
        if (markdown.length >= 200) {
          return {
            content: markdown,
            source: "wikipedia",
            timing: Date.now() - start,
          };
        }
      }

      // Fallback: summary endpoint (plain text intro)
      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const summaryResponse = await fetchWithTimeout(summaryUrl, {
        headers: {
          "User-Agent": "intercept-mcp/3.0.0 (https://github.com/bighippoman/intercept-mcp)",
          Accept: "application/json",
        },
      });

      if (!summaryResponse.ok) return null;

      const data = (await summaryResponse.json()) as {
        title?: string;
        extract?: string;
        description?: string;
        thumbnail?: { source: string };
      };

      if (!data.extract) return null;

      const parts: string[] = [];
      if (data.title) parts.push(`# ${data.title}`);
      if (data.description) parts.push(`*${data.description}*`);
      parts.push("", data.extract);

      return {
        content: parts.join("\n"),
        source: "wikipedia",
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
```

- [ ] **Step 2: Create `src/__tests__/handlers/wikipedia.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { wikipediaHandler } from "../../handlers/wikipedia.js";

describe("wikipediaHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and patterns", () => {
    expect(wikipediaHandler.name).toBe("wikipedia");
    expect(wikipediaHandler.patterns[0].test("https://en.wikipedia.org/wiki/TypeScript")).toBe(true);
    expect(wikipediaHandler.patterns[0].test("https://fr.wikipedia.org/wiki/JavaScript")).toBe(true);
  });

  it("does not match non-wiki URLs", () => {
    expect(wikipediaHandler.patterns[0].test("https://example.com")).toBe(false);
    expect(wikipediaHandler.patterns[0].test("https://en.wikipedia.org/")).toBe(false);
  });

  it("returns null for non-wikipedia URL", async () => {
    const result = await wikipediaHandler.handle("https://example.com");
    expect(result).toBeNull();
  });

  it("extracts content from HTML endpoint", async () => {
    const html = `<html><body><section><p>TypeScript is a programming language. ${"Content. ".repeat(30)}</p></section></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const result = await wikipediaHandler.handle("https://en.wikipedia.org/wiki/TypeScript");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("TypeScript");
    expect(result!.source).toBe("wikipedia");
  });

  it("falls back to summary endpoint when HTML extraction is too short", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("<html><body>Short</body></html>", { status: 200 })) // HTML too short
      .mockResolvedValueOnce(new Response(JSON.stringify({
        title: "TypeScript",
        description: "Programming language",
        extract: "TypeScript is a free and open-source high-level programming language.",
      }), { status: 200 })); // summary

    const result = await wikipediaHandler.handle("https://en.wikipedia.org/wiki/TypeScript");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("TypeScript");
    expect(result!.content).toContain("Programming language");
  });
});
```

- [ ] **Step 3: Register in `src/server.ts`**

Add import:
```typescript
import { wikipediaHandler } from "./handlers/wikipedia.js";
```

Add to `HANDLERS` array (before `githubHandler`):
```typescript
const HANDLERS: Handler[] = [
  twitterHandler,
  youtubeHandler,
  arxivHandler,
  pdfHandler,
  wikipediaHandler,
  githubHandler,
];
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/handlers/wikipedia.ts src/__tests__/handlers/wikipedia.test.ts src/server.ts
git commit -m "feat: add Wikipedia handler using Wikimedia REST API"
```

---

### Task 6: YouTube transcript extraction

**Files:**
- Modify: `src/handlers/youtube.ts`
- Modify: `src/__tests__/handlers/youtube.test.ts`

- [ ] **Step 1: Add transcript fetching to `src/handlers/youtube.ts`**

Add import at the top:
```typescript
import { fetchTranscript } from "youtube-transcript";
```

Add a helper function after the existing `formatDuration`:

```typescript
async function getTranscript(videoId: string): Promise<string | null> {
  try {
    const segments = await fetchTranscript(videoId);
    if (!segments || segments.length === 0) return null;
    const text = segments.map((s: { text: string }) => s.text).join(" ");
    // Truncate to avoid context window bloat
    return text.length > 15_000 ? text.slice(0, 15_000) + "\n\n[Transcript truncated]" : text;
  } catch {
    return null;
  }
}
```

In the `handle` method, after the description section (after `parts.push("");` on the last line before the return), add:

```typescript
      const transcript = await getTranscript(videoId);
      if (transcript) {
        parts.push("## Transcript");
        parts.push(transcript);
        parts.push("");
      }
```

- [ ] **Step 2: Add transcript tests to `src/__tests__/handlers/youtube.test.ts`**

Add these tests inside the existing `describe` block:

```typescript
  it("includes transcript when available", async () => {
    const html = `<html><body><script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Test","author":"Channel","shortDescription":"Desc","lengthSeconds":"120","viewCount":"1000"}};</script></body></html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    // Mock the youtube-transcript module
    const ytModule = await import("youtube-transcript");
    vi.spyOn(ytModule, "fetchTranscript").mockResolvedValueOnce([
      { text: "Hello world", offset: 0, duration: 2000, lang: "en" },
      { text: "This is a test", offset: 2000, duration: 3000, lang: "en" },
    ]);

    const result = await youtubeHandler.handle("https://www.youtube.com/watch?v=test123");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Transcript");
    expect(result!.content).toContain("Hello world");
    expect(result!.content).toContain("This is a test");
  });

  it("works without transcript", async () => {
    const html = `<html><body><script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Test","author":"Channel","shortDescription":"Desc","lengthSeconds":"120","viewCount":"1000"}};</script></body></html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const ytModule = await import("youtube-transcript");
    vi.spyOn(ytModule, "fetchTranscript").mockRejectedValueOnce(new Error("No captions"));

    const result = await youtubeHandler.handle("https://www.youtube.com/watch?v=test123");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("Test");
    expect(result!.content).not.toContain("Transcript");
  });
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/__tests__/handlers/youtube.test.ts`
Expected: All tests pass (existing + 2 new)

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/handlers/youtube.ts src/__tests__/handlers/youtube.test.ts
git commit -m "feat: add YouTube transcript extraction to YouTube handler"
```

---

### Task 7: DuckDuckGo search backend

**Files:**
- Create: `src/search/duckduckgo.ts`
- Create: `src/__tests__/search/duckduckgo.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Create `src/search/duckduckgo.ts`**

```typescript
import type { SearchResponse } from "../types.js";

export async function duckduckgoSearch(
  query: string,
  count: number,
): Promise<SearchResponse | null> {
  const start = Date.now();
  try {
    const { search, SafeSearchType } = await import("duck-duck-scrape");
    const results = await search(query, { safeSearch: SafeSearchType.MODERATE });

    if (!results.results || results.results.length === 0) return null;

    return {
      results: results.results.slice(0, count).map((r: { title: string; url: string; description: string }) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
      })),
      source: "duckduckgo",
      timing: Date.now() - start,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Create `src/__tests__/search/duckduckgo.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { duckduckgoSearch } from "../../search/duckduckgo.js";

describe("duckduckgoSearch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns search results", async () => {
    vi.mock("duck-duck-scrape", () => ({
      search: vi.fn().mockResolvedValue({
        results: [
          { title: "Result 1", url: "https://example.com/1", description: "First result" },
          { title: "Result 2", url: "https://example.com/2", description: "Second result" },
        ],
      }),
      SafeSearchType: { MODERATE: 1 },
    }));

    const result = await duckduckgoSearch("test query", 5);
    expect(result).not.toBeNull();
    expect(result!.results).toHaveLength(2);
    expect(result!.results[0].title).toBe("Result 1");
    expect(result!.source).toBe("duckduckgo");
    expect(result!.timing).toBeGreaterThanOrEqual(0);
  });

  it("respects count parameter", async () => {
    vi.mock("duck-duck-scrape", () => ({
      search: vi.fn().mockResolvedValue({
        results: [
          { title: "R1", url: "https://example.com/1", description: "D1" },
          { title: "R2", url: "https://example.com/2", description: "D2" },
          { title: "R3", url: "https://example.com/3", description: "D3" },
        ],
      }),
      SafeSearchType: { MODERATE: 1 },
    }));

    const result = await duckduckgoSearch("test", 2);
    expect(result).not.toBeNull();
    expect(result!.results).toHaveLength(2);
  });

  it("returns null on error", async () => {
    vi.mock("duck-duck-scrape", () => ({
      search: vi.fn().mockRejectedValue(new Error("Rate limited")),
      SafeSearchType: { MODERATE: 1 },
    }));

    const result = await duckduckgoSearch("test", 5);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 3: Add DDG as third fallback in `src/server.ts`**

Add import at top:
```typescript
import { duckduckgoSearch } from "./search/duckduckgo.js";
```

In the search tool callback, add DDG as third fallback after the SearXNG block and before the error return. Replace the `if (!searchResult) { return { isError: true, ... } }` block with:

```typescript
      if (!searchResult) {
        searchResult = await duckduckgoSearch(query, count);
      }

      if (!searchResult) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Search failed. All search backends unavailable. Optionally set BRAVE_API_KEY or SEARXNG_URL for more reliable search.",
            },
          ],
        };
      }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/search/duckduckgo.ts src/__tests__/search/duckduckgo.test.ts src/server.ts
git commit -m "feat: add DuckDuckGo as zero-config fallback search backend"
```

---

### Task 8: Build and verify end-to-end

**Files:**
- No new files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 3: Verify server starts and lists all tools/handlers/prompts**

```bash
node -e "
const { spawn } = require('child_process');
const child = spawn('node', ['build/index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', d => output += d.toString());
const init = JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'0.1.0'}}});
const notif = JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'});
const list = JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}});
child.stdin.write(init + '\n');
setTimeout(() => child.stdin.write(notif + '\n'), 200);
setTimeout(() => child.stdin.write(list + '\n'), 400);
setTimeout(() => { console.log(output); child.kill(); }, 1500);
"
```

Expected: Both tools listed with annotations. Server responds with capabilities including `tools` and `prompts`.

- [ ] **Step 4: Commit any final fixes**

If any fixes were needed, commit them.
