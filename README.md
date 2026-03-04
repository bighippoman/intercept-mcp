# intercept-mcp

MCP server that fetches web content as clean markdown, extracts transcripts, reads PDFs, and searches the web. Multi-tier fallback chain with site-specific handlers. Always returns something useful.

## Install

```bash
claude mcp add intercept -- npx -y intercept-mcp
```

## How it works

URLs are processed in three stages:

### 1. Site-specific handlers

Known URL patterns are routed to dedicated handlers before the fallback pipeline:

| Pattern | Handler | What you get |
|---------|---------|-------------|
| `twitter.com/*/status/*`, `x.com/*/status/*` | Twitter/X | Tweet text, author, media, engagement stats |
| `youtube.com/watch?v=*`, `youtu.be/*` | YouTube | Title, description, full transcript with timestamps |
| `arxiv.org/abs/*`, `arxiv.org/pdf/*` | arXiv | Paper metadata, authors, abstract, categories |
| `*.pdf` | PDF | Extracted text (text-layer PDFs only) |

### 2. Fallback pipeline

If no handler matches (or the handler returns nothing), the URL enters the multi-tier pipeline:

| Tier | Fetcher | Strategy |
|------|---------|----------|
| 1 | Jina Reader | Clean text extraction service |
| 2 | archive.ph + Wayback | Archived versions (run in parallel) |
| 3 | Raw fetch | Direct GET with browser headers |
| 4 | RSS, CrossRef, Semantic Scholar, HN, Reddit | Metadata / discussion fallbacks |
| 5 | OG Meta | Open Graph tags (guaranteed fallback) |

Tier 2 fetchers run in parallel. When both succeed, the higher quality result wins; ties go to archive.ph (more recent snapshots). All other tiers run sequentially.

### 3. Caching

Results are cached in-memory for the session (max 100 entries, LRU eviction). Failed URLs are also cached to prevent re-attempting known-dead URLs.

## Tools

### `fetch`

Fetch a URL and return its content as clean markdown.

- `url` (string, required) — URL to fetch
- `maxTier` (number, optional, 1-5) — Stop at this tier for speed-sensitive cases

### `search`

Search the web and return results.

- `query` (string, required) — Search query
- `count` (number, optional, 1-20, default 5) — Number of results

Uses Brave Search API if `BRAVE_API_KEY` is set, otherwise falls back to SearXNG.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BRAVE_API_KEY` | No | Brave Search API key ([free tier: 2,000 queries/month](https://brave.com/search/api/)) |
| `SEARXNG_URL` | No | Self-hosted SearXNG instance URL |

Search works without any keys using a public SearXNG instance, but public instances can be unreliable. For serious use, set `BRAVE_API_KEY` or `SEARXNG_URL`.

## URL normalization

Incoming URLs are automatically cleaned:

- Strips 70+ tracking params (UTM, click IDs, analytics, paywall triggers, A/B testing, etc.)
- Removes hash fragments
- Upgrades to HTTPS
- Cleans AMP artifacts
- Preserves pagination params (`page`, `offset`, `limit`)

## Content quality detection

Each fetcher result is scored for quality. Automatic fail on:

- CAPTCHA / Cloudflare challenges
- Login walls / paywalls
- HTTP error pages in body
- Content under 200 characters

## Requirements

- Node.js >= 18
- No API keys required for basic use
