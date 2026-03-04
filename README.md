# intercept-mcp

MCP server that fetches web content as clean markdown using a multi-tier fallback chain. When one source fails or returns garbage, it automatically tries the next. Always returns something useful.

## Install

```bash
claude mcp add intercept -- npx -y intercept-mcp
```

## How it works

Sequential pipeline of 10 fetchers across 5 tiers:

| Tier | Fetcher | Strategy |
|------|---------|----------|
| 1 | Jina Reader | Clean text extraction service |
| 2 | archive.ph | Cached/archived version |
| 2 | Wayback Machine | Internet Archive snapshot |
| 3 | Raw fetch | Direct GET with browser headers |
| 4 | RSS | Feed lookup for matching article |
| 4 | CrossRef | DOI/academic paper metadata |
| 4 | Semantic Scholar | Paper abstract + TL;DR |
| 4 | HackerNews | HN discussion via Algolia |
| 4 | Reddit | Reddit discussion threads |
| 5 | OG Meta | Open Graph tags (guaranteed fallback) |

Each result is quality-scored (0-1). The pipeline stops at the first result scoring above 0.3. If everything fails, OG meta always returns something.

## Tool API

**`fetch`** — Fetch a URL and return its content as clean markdown.

- `url` (string, required) — URL to fetch
- `maxTier` (number, optional, 1-5) — Stop at this tier for speed-sensitive cases

Output includes the content plus a metadata footer showing which source succeeded and what was attempted.

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
- No API keys needed — all services are free/freemium
