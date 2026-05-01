# intercept-mcp

Give your AI the ability to read the web. One command, no API keys required.

Without it, your AI hits a URL and gets a 403, a wall, or a wall of raw HTML. With intercept, it almost always gets the content — clean markdown, ready to use.

Handles tweets, YouTube videos (with transcripts when available), arXiv papers, PDFs, Wikipedia articles, and GitHub repos. If the first strategy fails, it tries up to 10 more before giving up.

Works with any MCP client: Claude Code, Claude Desktop, Codex, Cursor, Windsurf, Cline, and more.

<a href="https://glama.ai/mcp/servers/@bighippoman/intercept-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@bighippoman/intercept-mcp/badge" alt="intercept-mcp MCP server" />
</a>

## Install

### Claude Code

```bash
claude mcp add intercept -s user -- npx -y intercept-mcp
```

### Codex

```bash
codex mcp add intercept -- npx -y intercept-mcp
```

### Cursor

Settings → MCP → Add Server:

```json
{
  "mcpServers": {
    "intercept": {
      "command": "npx",
      "args": ["-y", "intercept-mcp"]
    }
  }
}
```

### Windsurf

Settings → MCP → Add Server → same JSON config as above.

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "intercept": {
      "command": "npx",
      "args": ["-y", "intercept-mcp"]
    }
  }
}
```

### Other MCP clients

Any client that supports stdio MCP servers can run `npx -y intercept-mcp`.

No API keys needed for the `fetch` tool.

## How it works

URLs are processed in three stages:

### 1. Site-specific handlers

Known URL patterns are routed to dedicated handlers before the fallback pipeline:

| Pattern | Handler | What you get |
|---------|---------|-------------|
| `twitter.com/*/status/*`, `x.com/*/status/*` | Twitter/X | Tweet text, author, media, engagement stats (via third-party APIs) |
| `youtube.com/watch?v=*`, `youtu.be/*` | YouTube | Title, channel, duration, views, description, transcript (when captions available) |
| `arxiv.org/abs/*`, `arxiv.org/pdf/*` | arXiv | Paper metadata, authors, abstract, categories |
| `*.pdf` | PDF | Extracted text (text-layer PDFs only) |
| `*.wikipedia.org/wiki/*` | Wikipedia | Clean article content via Wikimedia REST API |
| `github.com/{owner}/{repo}` | GitHub | Raw README.md content |

### 2. Fallback pipeline

If no handler matches (or the handler returns nothing), the URL enters the multi-tier pipeline:

| Tier | Fetcher | Strategy |
|------|---------|----------|
| 1 | Cloudflare Browser Run | JS rendering + markdown extraction (optional, needs API token) |
| 1 | Jina Reader | Clean markdown extraction service |
| 2 | Wayback + Codetabs | Archived version + CORS proxy (run in parallel) |
| 3 | Raw fetch | Direct GET with browser headers + Turndown markdown conversion |
| 3 | Stealth fetch | Browser TLS fingerprint impersonation via got-scraping (opt-in, see below) |
| 4 | RSS, CrossRef, Semantic Scholar, HN, Reddit | Metadata / discussion fallbacks |
| 5 | OG Meta | Open Graph tags (guaranteed fallback) |

Tier 2 fetchers run in parallel. When both succeed, the higher quality result wins. All other tiers run sequentially.

All fetchers return proper **Markdown** (headings, links, bold, tables, code blocks) via Turndown — not plain text.

### 3. Caching

Results are cached in-memory with TTL (30 min for successes, 5 min for failures). Max 100 entries with LRU eviction. Failed URLs are cached to prevent re-attempting known-dead URLs.

## Tools

### `fetch`

Fetch a URL and return its content as clean markdown.

- `url` (string, required) — URL to fetch
- `maxTier` (number, optional, 1-5) — Stop at this tier for speed-sensitive cases

### `search`

Search the web and return results.

- `query` (string, required) — Search query
- `count` (number, optional, 1-20, default 5) — Number of results

Uses Brave Search API if `BRAVE_API_KEY` is set, then SearXNG if `SEARXNG_URL` is set, then DuckDuckGo as an unreliable last resort.

## Prompts

### `research-topic`

Search for a topic and fetch the top results for a multi-source summary.

- `topic` (string) — The topic to research
- `depth` (string, default "3") — Number of top results to fetch

### `extract-article`

Fetch a URL and extract the key points from the content.

- `url` (string) — The URL to fetch and summarize

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BRAVE_API_KEY` | No | [Brave Search API](https://brave.com/search/api/) key for search |
| `SEARXNG_URL` | No | Self-hosted SearXNG instance URL (recommended) |
| `CF_API_TOKEN` | No | Cloudflare API token with "Browser Rendering - Edit" permission |
| `CF_ACCOUNT_ID` | No | Cloudflare account ID (required if `CF_API_TOKEN` is set) |
| `USE_STEALTH_FETCH` | No | Set to `true` to enable stealth fetcher (see warning below) |

**Search:** Has a DuckDuckGo fallback but it's rate-limited and unreliable. For production use, self-host [SearXNG](https://docs.searxng.org/) and set `SEARXNG_URL` (see below), or get a [Brave Search API key](https://brave.com/search/api/).

**Fetch:** Works without any keys. Set `CF_API_TOKEN` + `CF_ACCOUNT_ID` to enable Cloudflare Browser Run (formerly Browser Rendering) for JavaScript-heavy pages (SPAs, React sites).

### Stealth fetch (USE_STEALTH_FETCH)

**Use at your own risk.** When enabled, this adds a fetcher that impersonates real browser TLS fingerprints (Chrome/Firefox cipher suites, HTTP/2 settings, header ordering) using [got-scraping](https://github.com/apify/got-scraping). This can bypass bot detection and CAPTCHA triggers on sites that would otherwise block automated requests.

This fetcher runs at tier 3 after the regular raw fetch. If the raw fetch gets blocked (CAPTCHA, Cloudflare challenge, 403), the stealth fetcher retries with browser impersonation.

**This may violate the terms of service of some websites.** The authors of intercept-mcp take no responsibility for how this feature is used. It is disabled by default and must be explicitly opted into.

## Self-hosting SearXNG

For reliable search, self-host SearXNG with Docker. A config is included in the [repo](https://github.com/bighippoman/intercept-mcp/tree/main/searxng):

```bash
git clone https://github.com/bighippoman/intercept-mcp.git
cd intercept-mcp/searxng && docker compose up -d
```

Then set `SEARXNG_URL=http://localhost:8888`. No rate limits, no CAPTCHAs, aggregates Google + Bing + DuckDuckGo + Wikipedia + Brave.

Or use any existing SearXNG instance — just set `SEARXNG_URL` to its URL.

## URL normalization

Incoming URLs are automatically cleaned:

- Strips 60+ tracking params (UTM, click IDs, analytics, A/B testing, etc.)
- Removes hash fragments
- Upgrades to HTTPS
- Cleans AMP artifacts
- Preserves functional params (`ref`, `format`, `page`, `offset`, `limit`)

## Content quality detection

Each fetcher result is scored for quality. Automatic fail on:

- CAPTCHA / Cloudflare challenges
- Login walls
- HTTP error pages in body
- Content under 200 characters

## Requirements

- Node.js >= 18
- No API keys required for basic use
