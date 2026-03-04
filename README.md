# intercept-mcp

Give your AI the ability to read the web. One command, no API keys required.

Without it, your AI hits a URL and gets a 403, a paywall, or a wall of raw HTML. With intercept, it almost always gets the content — clean markdown, ready to use.

Handles tweets, YouTube videos, arXiv papers, PDFs, and regular web pages. If the first strategy fails, it tries up to 8 more before giving up.

Works with any MCP client: Claude Code, Claude Desktop, Codex, Cursor, Windsurf, Cline, and more.

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
| `twitter.com/*/status/*`, `x.com/*/status/*` | Twitter/X | Tweet text, author, media, engagement stats |
| `youtube.com/watch?v=*`, `youtu.be/*` | YouTube | Title, channel, duration, views, description |
| `arxiv.org/abs/*`, `arxiv.org/pdf/*` | arXiv | Paper metadata, authors, abstract, categories |
| `*.pdf` | PDF | Extracted text (text-layer PDFs only) |

### 2. Fallback pipeline

If no handler matches (or the handler returns nothing), the URL enters the multi-tier pipeline:

| Tier | Fetcher | Strategy |
|------|---------|----------|
| 1 | Jina Reader | Clean text extraction service |
| 2 | Wayback + Codetabs | Archived version + CORS proxy (run in parallel) |
| 3 | Raw fetch | Direct GET with browser headers |
| 4 | RSS, CrossRef, Semantic Scholar, HN, Reddit | Metadata / discussion fallbacks |
| 5 | OG Meta | Open Graph tags (guaranteed fallback) |

Tier 2 fetchers run in parallel. When both succeed, the higher quality result wins. All other tiers run sequentially.

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

The `search` tool needs at least one backend configured. Public SearXNG instances are rate-limited and unreliable in practice. A free [Brave Search API key](https://brave.com/search/api/) (2,000 queries/month) is the realistic zero-cost option. Set `SEARXNG_URL` only if you run your own instance.

The `fetch` tool works without any keys.

## URL normalization

Incoming URLs are automatically cleaned:

- Strips 60+ tracking params (UTM, click IDs, analytics, paywall triggers, A/B testing, etc.)
- Removes hash fragments
- Upgrades to HTTPS
- Cleans AMP artifacts
- Preserves functional params (`ref`, `format`, `page`, `offset`, `limit`)

## Content quality detection

Each fetcher result is scored for quality. Automatic fail on:

- CAPTCHA / Cloudflare challenges
- Login walls / paywalls
- HTTP error pages in body
- Content under 200 characters

## Requirements

- Node.js >= 18
- No API keys required for basic use (fetch only)
