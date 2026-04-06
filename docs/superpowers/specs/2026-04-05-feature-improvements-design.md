# Feature Improvements Design Spec

## Goal

Add 6 features to intercept-mcp that address the biggest gaps vs competitors: Markdown output, JS-rendered page support via Cloudflare, and dedicated handlers for the most commonly fetched URL types.

## Principles

- All new env vars are **optional** — zero-config story stays intact
- No new heavy dependencies (no Puppeteer/Playwright/JSDOM)
- Each feature is an independent module following existing patterns
- All features get real e2e tests

---

## Feature 1: Turndown (HTML → Markdown)

**Problem:** `htmlToText()` in `src/html.ts` uses `article.textContent` which strips all structure. Every competitor returns Markdown.

**Solution:** New `htmlToMarkdown()` function that uses Readability's `article.content` (clean HTML) and passes it through Turndown.

**Dependencies:**
- `turndown` (3.75M weekly downloads)
- `@truto/turndown-plugin-gfm` (ESM-compatible fork — tables, strikethrough, task lists, fenced code)

**Changes:**
- `src/html.ts`: Add `htmlToMarkdown(html: string): string` alongside existing `htmlToText()`
  - Use Readability to get `article.content` (HTML, not textContent)
  - Pass through Turndown with GFM plugin
  - Regex fallback also goes through Turndown instead of tag-stripping
- `src/fetchers/raw.ts`: Change `htmlToText(html)` → `htmlToMarkdown(html)`
- `src/fetchers/wayback.ts`: Same change
- `src/fetchers/codetabs.ts`: Same change
- `src/fetchers/rss.ts`: Same change (the `htmlToText` call on feed item content)
- `src/fetchers/og-meta.ts`: No change (already outputs formatted text, not HTML)

**Config:** `headingStyle: 'atx'`, `codeBlockStyle: 'fenced'`, GFM plugin enabled.

---

## Feature 2: Cloudflare Browser Rendering Fetcher

**Problem:** No JS rendering. SPAs, React sites, dynamic content return empty/broken content.

**Solution:** New fetcher `src/fetchers/cloudflare.ts` that calls CF's `/markdown` REST API. Tier 1 (alongside Jina). Only active when env vars are set.

**Env vars (both optional):**
- `CF_API_TOKEN` — Cloudflare API token with "Browser Rendering - Edit" permission
- `CF_ACCOUNT_ID` — Cloudflare account ID

**API call:**
```
POST https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/browser-rendering/markdown
Authorization: Bearer {CF_API_TOKEN}
Content-Type: application/json

{
  "url": "<target>",
  "gotoOptions": { "waitUntil": "networkidle0" },
  "rejectResourceTypes": ["image", "font", "media", "stylesheet"]
}
```

**Response:** `{ "success": true, "result": "# Markdown content..." }`

**Behavior:**
- Tier 1, runs before Jina (CF renders JS, Jina doesn't always)
- Returns `null` if env vars not set (skipped entirely)
- Returns `null` on 429 (rate limit), 4xx, 5xx errors
- 15-second timeout (CF default is 30s but we want to fail fast to fallback)
- Quality scored on the returned markdown as usual

**Pricing context (for README docs):**
- Free: 10 min/day browser time, 6 req/min
- Paid ($5/mo Workers): 10 hrs/month, 600 req/min

---

## Feature 3: GitHub Handler

**Problem:** GitHub repo pages through the generic pipeline return cluttered HTML.

**Solution:** New handler `src/handlers/github.ts` that fetches raw README.md directly.

**Pattern:** `github.com/{owner}/{repo}` (repo root URLs only, not file/blob/tree URLs)

**Regex:** `/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)\/?$/`

**Fetch strategy:**
1. Try `https://raw.githubusercontent.com/{owner}/{repo}/HEAD/README.md`
2. If 404, try with `main` branch, then `master`
3. Content is already Markdown — no conversion needed
4. Prepend `# {owner}/{repo}` header

**No dependencies, no API key required.** Unauthenticated GitHub rate limit is 60 req/hr/IP which is fine.

---

## Feature 4: Wikipedia Handler

**Problem:** Wikipedia through generic pipeline is noisy (citations, edit links, nav).

**Solution:** New handler `src/handlers/wikipedia.ts` using the Wikimedia REST API.

**Pattern:** `en.wikipedia.org/wiki/{title}` (and other language subdomains)

**Regex:** `/^https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/(.+)/`

**Fetch strategy:**
1. Extract language code and title from URL
2. Fetch `https://{lang}.wikipedia.org/api/rest_v1/page/html/{title}`
3. Pass HTML through `htmlToMarkdown()` (Feature 1)
4. Fallback: fetch `/page/summary/{title}` for JSON with `extract` (plain text intro)

**No dependencies, no API key.** Wikimedia asks for a descriptive User-Agent header.

---

## Feature 5: YouTube Transcript Extraction

**Problem:** YouTube handler gets metadata but not the actual spoken content.

**Solution:** Extend existing `src/handlers/youtube.ts` to also fetch video captions.

**Dependency:** `youtube-transcript` (simplest, most popular, zero API key)

**Changes to youtube handler:**
1. After extracting `videoDetails`, try `fetchTranscript(videoId)`
2. If transcript available, join segment texts and append as `## Transcript` section
3. Wrap in try/catch — transcripts aren't always available (live streams, music, disabled captions)
4. Truncate transcript to first 15,000 chars to avoid context window bloat

**No API key required.** Uses YouTube's internal InnerTube API.

---

## Feature 6: DuckDuckGo Search Backend

**Problem:** When neither `BRAVE_API_KEY` nor `SEARXNG_URL` is set, search returns an error.

**Solution:** New search backend `src/search/duckduckgo.ts` as last-resort fallback.

**Dependency:** `duck-duck-scrape` (most mature DDG scraping library)

**Changes:**
- `src/search/duckduckgo.ts`: New file following same `SearchResponse` pattern as brave.ts/searxng.ts
- `src/server.ts`: Add DDG as third fallback: Brave → SearXNG → DuckDuckGo

**No API key required.** DDG is free but rate-limits aggressively. Treat as best-effort fallback, not primary.

**Caveat for docs:** DDG may serve CAPTCHAs to automated requests. This is a resilience fallback, not a replacement for Brave/SearXNG.

---

## File Map

### New files:
- `src/fetchers/cloudflare.ts` — CF Browser Rendering fetcher
- `src/handlers/github.ts` — GitHub README handler
- `src/handlers/wikipedia.ts` — Wikipedia REST API handler
- `src/search/duckduckgo.ts` — DuckDuckGo search backend

### Modified files:
- `src/html.ts` — Add `htmlToMarkdown()` function
- `src/fetchers/raw.ts` — Use `htmlToMarkdown` instead of `htmlToText`
- `src/fetchers/wayback.ts` — Same
- `src/fetchers/codetabs.ts` — Same
- `src/fetchers/rss.ts` — Same
- `src/handlers/youtube.ts` — Add transcript extraction
- `src/server.ts` — Register new handlers, fetchers, search backend

### New dependencies:
- `turndown`
- `@truto/turndown-plugin-gfm`
- `youtube-transcript`
- `duck-duck-scrape`

---

## Testing

Each feature gets:
- Unit tests with mocked fetch (in existing `__tests__/` structure)
- Real e2e tests added to `e2e.test.ts`

Specific tests:
- Turndown: real HTML → verify Markdown output has headers, links, lists
- CF fetcher: mock CF API response, verify markdown extraction + error handling + env var gating
- GitHub handler: real `github.com/nodejs/node` → verify README content
- Wikipedia handler: real `en.wikipedia.org/wiki/TypeScript` → verify article content
- YouTube transcript: real video → verify transcript text (when available)
- DuckDuckGo: real search query → verify results array (may be flaky due to rate limiting)
