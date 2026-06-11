# intercept-mcp

Give your AI the ability to read the web. One command, no API keys required.

Without it, your AI hits a URL and gets a 403, a wall, or a wall of raw HTML. With intercept, it almost always gets the content — clean markdown, ready to use.

Handles tweets, YouTube videos (with transcripts when available), arXiv papers, PDFs, Wikipedia articles, and GitHub repos. If the first strategy fails, it tries up to 14 more before giving up.

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

URLs are processed in four stages:

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
| `github.com/{o}/{r}/blob/{ref}/{path}` | GitHub | Raw file content, code-fenced by language |
| `github.com/{o}/{r}/issues/{n}`, `/pull/{n}` | GitHub | Issue/PR title, state, body, diff stats, comments (via GitHub API) |
| `github.com/{o}/{r}/releases/tag/{t}`, `/releases/latest` | GitHub | Release notes (via GitHub API) |

The GitHub API endpoints work unauthenticated (60 requests/hour). Set `GITHUB_TOKEN` to raise the limit.

### 2. Shared cache (agentsweb.org)

Before hitting any fetcher, every request checks [agentsweb.org](https://agentsweb.org) — a global shared markdown cache for AI agents backed by a 9-source parallel fetch pipeline with JS/SPA rendering (React, Vue, Angular via Cloudflare Browser Run). If another agent already fetched this URL, you get the result in under 50ms.

Every successful fetch contributes back automatically. Entries gain trust through a self-healing consensus model: when independent instances fetch the same URL and confirm the same content, confidence increases.

Opt out entirely with `INTERCEPT_SHARED_CACHE=false`, or use read-only mode (consume but never contribute) with `INTERCEPT_CACHE_READ_ONLY=true`.

#### agentsweb.org API

agentsweb.org also exposes standalone endpoints for direct use:

- **`/web?q=`** — search the web
- **`/research?q=`** — search + fetch + cache in one call
- **`/fetch?url=`** — fetch on demand, auto-cached

See [agentsweb.org/docs](https://agentsweb.org/docs) for full API documentation.

### 3. Fallback pipeline

If no handler matches (or the handler returns nothing), the URL enters the multi-tier pipeline:

| Tier | Fetcher | Strategy |
|------|---------|----------|
| 0 | agentsweb.org | Global shared markdown cache — instant if another agent already fetched this URL |
| 1 | Cloudflare Browser Run | JS/SPA rendering + markdown extraction — also powers [agentsweb.org](https://agentsweb.org) (optional, needs API token) |
| 1 | Jina Reader | Clean markdown extraction service |
| 2 | Wayback Machine | Archived version from archive.org |
| 2 | Arquivo.pt | Portuguese web archive (broad international coverage) |
| 2 | Common Crawl | Petabyte web archive read from Common Crawl's index + S3 — not subject to the origin's rate limits, bot detection, or paywall |
| 2 | Codetabs | CORS proxy |
| 3 | Markdown endpoint | Asks the site for a native markdown version (`<path>.md` + `Accept: text/markdown`) |
| 3 | archive.ph | Archived snapshots via timemap API + stealth TLS fetch |
| 3 | Raw fetch | Direct GET with browser headers + Turndown markdown conversion |
| 3 | Stealth fetch | Browser TLS fingerprint impersonation via got-scraping (opt-in, see below) |
| 3 | FlareSolverr | Real-browser challenge solver for Cloudflare/DDoS-Guard (opt-in, needs a FlareSolverr instance) |
| 4 | RSS, CrossRef, Semantic Scholar, HN, Reddit | Metadata / discussion fallbacks |
| 5 | OG Meta | Open Graph tags (guaranteed fallback) |

Tier 2 fetchers run in parallel. When multiple succeed, the highest quality result wins. All other tiers run sequentially.

All fetchers return proper **Markdown** (headings, links, bold, tables, code blocks) via Turndown — not plain text.

### 4. Caching

Results are cached in-memory with TTL (60 min for successes, 5 min for failures). Max 250 entries with LRU eviction. Failed URLs are cached to prevent re-attempting known-dead URLs. All three knobs are configurable via `INTERCEPT_CACHE_TTL_MS`, `INTERCEPT_CACHE_FAILURE_TTL_MS`, and `INTERCEPT_CACHE_SIZE`.

## Tools

### `fetch`

Fetch a URL and return its content as clean markdown.

- `url` (string, required) — URL to fetch
- `maxTier` (number, optional, 1-5) — Stop at this tier for speed-sensitive cases
- `maxLength` (number, optional, default 50000) — Maximum characters to return
- `startIndex` (number, optional, default 0) — Character offset for paginating long content
- `noCache` (boolean, optional) — Skip session and shared caches and fetch live

Long pages are truncated at `maxLength` with a notice telling the agent which `startIndex` continues the content. Structured output reports `source`, `quality`, `contentLength`, `truncated`, `nextStartIndex`, and `cacheAgeSeconds` so agents can branch on them programmatically.

Direct image URLs (`.png`, `.jpg`, `.gif`, `.webp`, up to 5 MB) are returned as an MCP **image block** instead of text, so the agent's own vision model can read charts, diagrams, screenshots, and scanned documents. The structured output reports `source: "image"`, `mimeType`, and `bytes`.

### `fetch_batch`

Fetch up to 10 URLs in parallel, each through the same handler/fallback chain.

- `urls` (string[], required, 1-10) — URLs to fetch
- `maxTier`, `noCache` — as in `fetch`
- `maxLength` (number, optional, default 20000) — Per-URL character budget

### `research`

Search the web and fetch the top results in one call — replaces a search followed by several fetches.

- `query` (string, required) — Search query
- `count` (number, optional, 1-5, default 3) — Results to fetch
- `maxLength` (number, optional, default 20000) — Per-result character budget
- `site` (string, optional) — Restrict to a domain
- `freshness` (string, optional) — `day`, `week`, `month`, or `year`

### `search`

Search the web and return results.

- `query` (string, required) — Search query
- `count` (number, optional, 1-20, default 5) — Number of results
- `site` (string, optional) — Restrict results to a domain
- `freshness` (string, optional) — `day`, `week`, `month`, or `year`
- `page` (number, optional, 1-10) — Results page for pagination

Uses Brave Search API if `BRAVE_API_KEY` is set, then SearXNG if `SEARXNG_URL` is set, then DuckDuckGo as an unreliable last resort. `freshness` and `page` are ignored by the DuckDuckGo fallback.

### `extract`

Extract specific values from a page as JSON instead of markdown prose — for when you need particular data, not the whole page. Honors per-domain auth and proxies.

- `url` (string, required) — The URL to extract from
- `selectors` (object, optional) — Map of field name → CSS selector. Each value is either a selector string (returns the first match's text) or `{ selector, attr?, all? }` — `attr` extracts an attribute (e.g. `href`), `all: true` returns every match as an array.
- `tables` (boolean, optional) — Convert every HTML table to an array of row objects (defaults to true when no `selectors` are given).

```json
{
  "url": "https://shop.example.com/item",
  "selectors": {
    "title": "h1",
    "price": ".price",
    "images": { "selector": "img.gallery", "attr": "src", "all": true }
  }
}
```

Returns the extracted `fields` and/or `tables` as structured output.

## Resources

### `intercept://session/recent`

Markdown list of URLs fetched and cached in this session, most recent first. Re-fetching any of them is instant.

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
| `GITHUB_TOKEN` | No | GitHub token raising API rate limits for the issue/PR/release handler |
| `INTERCEPT_AUTH` | No | JSON map of domain → headers/cookies, to fetch content you're logged in to (see [Per-domain authentication](#per-domain-authentication-intercept_auth)) |
| `CF_API_TOKEN` | No | Cloudflare API token with "Browser Rendering - Edit" permission |
| `CF_ACCOUNT_ID` | No | Cloudflare account ID (required if `CF_API_TOKEN` is set) |
| `USE_STEALTH_FETCH` | No | Set to `true` to enable stealth fetcher (see warning below) |
| `FLARESOLVERR_URL` | No | URL of a [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) instance (e.g. `http://localhost:8191`) to solve Cloudflare/DDoS-Guard challenges |
| `INTERCEPT_SHARED_CACHE` | No | Set to `false` to disable the agentsweb.org shared cache |
| `INTERCEPT_CACHE_READ_ONLY` | No | Set to `true` to consume but never contribute to the shared cache |
| `INTERCEPT_CACHE_TTL_MS` | No | In-memory cache TTL for successful fetches in ms (default `3600000` = 60 min) |
| `INTERCEPT_CACHE_FAILURE_TTL_MS` | No | In-memory cache TTL for failed fetches in ms (default `300000` = 5 min) |
| `INTERCEPT_CACHE_SIZE` | No | Max in-memory cache entries (default `250`) |
| `HTTPS_PROXY` / `HTTP_PROXY` | No | Standard proxy passthrough — routes all outbound fetches (including stealth) through the proxy. Honors `NO_PROXY`. |
| `INTERCEPT_PROXIES` | No | Comma/space-separated list of HTTP(S) proxies to rotate across, with automatic retry through the next proxy on a blocked response. Takes precedence over `HTTPS_PROXY`. |

**Search:** Has a DuckDuckGo fallback but it's rate-limited and unreliable. For production use, self-host [SearXNG](https://docs.searxng.org/) and set `SEARXNG_URL` (see below), or get a [Brave Search API key](https://brave.com/search/api/).

**Fetch:** Works without any keys. Set `CF_API_TOKEN` + `CF_ACCOUNT_ID` to enable Cloudflare Browser Run (formerly Browser Rendering) for JavaScript-heavy pages (SPAs, React sites).

### Stealth fetch (USE_STEALTH_FETCH)

**Use at your own risk.** When enabled, this adds a fetcher that impersonates real browser TLS fingerprints (Chrome/Firefox cipher suites, HTTP/2 settings, header ordering) using [got-scraping](https://github.com/apify/got-scraping). This can bypass bot detection and CAPTCHA triggers on sites that would otherwise block automated requests.

This fetcher runs at tier 3 after the regular raw fetch. If the raw fetch gets blocked (CAPTCHA, Cloudflare challenge, 403), the stealth fetcher retries with browser impersonation.

**This may violate the terms of service of some websites.** The authors of intercept-mcp take no responsibility for how this feature is used. It is disabled by default and must be explicitly opted into.

### Challenge solving (FLARESOLVERR_URL)

The stealth fetcher impersonates a browser's TLS fingerprint, but it can't *execute* a JavaScript challenge — so sites protected by a Cloudflare "Checking your browser" / DDoS-Guard interstitial still block it. [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) runs a real headless browser that solves the challenge and returns the page HTML.

Run it (Docker):

```bash
docker run -d -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest
```

Then set `FLARESOLVERR_URL=http://localhost:8191`. It runs at tier 3 as a last resort after the raw and stealth fetchers, and only when this variable is set. Solving a challenge can take 30–60s, so it's the slowest fetcher — but it recovers pages nothing else can.

### Bring-your-own proxy (HTTPS_PROXY)

If raw fetches start getting flagged, the most effective fix is usually a clean outbound IP — not a fancier fingerprint. intercept-mcp honors the standard `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` env vars, so you can route all outbound traffic through whatever proxy you already have:

```bash
HTTPS_PROXY=http://user:pass@proxy.example.com:8080 npx intercept-mcp
```

This works with any HTTP(S) proxy — a self-hosted Squid, a Tailscale exit node, a $5 VPS running [3proxy](https://github.com/3proxy/3proxy), or commercial residential proxies (Bright Data, Oxylabs, etc.). The stealth fetcher and `got-scraping` calls also pick this up automatically.

### Proxy rotation (INTERCEPT_PROXIES)

A single proxy still presents a single IP, which can itself get flagged under load. Set `INTERCEPT_PROXIES` to a comma- or space-separated list and intercept-mcp round-robins across them, automatically retrying through the next proxy when a request comes back blocked (HTTP 403, 429, 451, 503) or errors:

```bash
INTERCEPT_PROXIES="http://user:pass@p1.example.com:8080,http://user:pass@p2.example.com:8080,http://p3.example.com:8080" npx intercept-mcp
```

Requests spread across the list, and a blocked response is retried through a different egress (up to 3 attempts) before giving up — so a handful of cheap proxies, or a rotating residential endpoint listed multiple times, behave like a pool. `INTERCEPT_PROXIES` takes precedence over `HTTPS_PROXY`, applies per request (so the stealth and archive.ph `got-scraping` calls rotate too), and accepts HTTP(S) proxies. Invalid entries are ignored.

## Per-domain authentication (INTERCEPT_AUTH)

Most of the web is behind a login. `INTERCEPT_AUTH` lets you attach your own headers or cookies to requests for a specific origin, so the fetch tools can read content you're legitimately signed in to — a paid subscription, a private dashboard, an intranet, an authenticated API.

It's a JSON object mapping a domain to a header map. A domain also matches its subdomains:

```bash
INTERCEPT_AUTH='{
  "nytimes.com": { "Cookie": "nyt-s=...; nyt-a=..." },
  "api.acme.com": { "Authorization": "Bearer eyJ..." }
}' npx intercept-mcp
```

To get a cookie: open the site logged-in, open DevTools → Network, copy the `Cookie` request header from any request to that domain.

### Security model — read this before using it

- **Credentials only ever go to the configured origin.** Headers are keyed on the *actual host being contacted*. When intercept fetches a page through Jina, a web archive, a CORS proxy, FlareSolverr, or the shared cache, those intermediaries connect to a *different* host, so your cookie/token is **never** sent to them — only a direct fetch of the origin carries it.
- **Authenticated responses never touch the shared cache.** When a request matches an `INTERCEPT_AUTH` entry, intercept does not read from or write to the public [agentsweb.org](https://agentsweb.org) cache for that URL — so your private/paid content is never published, and you always get *your* authenticated view rather than a stranger's anonymous copy. (The in-process session cache still applies.)
- **Treat the value as a secret.** It contains live session tokens. Environment variables are visible to the process and its children and may be captured in shell history or process listings — prefer a secrets manager or a non-committed env file, and never commit it. Cookies expire, so you'll periodically need to refresh them.
- **You are responsible for authorized use.** Only supply credentials for accounts you own or are permitted to use, and respect each site's terms of service. intercept simply forwards the headers you provide.

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

## SSRF protection

Agents pass URLs taken from untrusted web content, so the fetch tools refuse anything pointing at local or internal infrastructure: loopback and private IPv4/IPv6 ranges, link-local addresses (including the `169.254.169.254` cloud metadata endpoint), CGNAT, multicast/reserved ranges, and local hostnames (`localhost`, `*.local`, `*.internal`, `*.home.arpa`). Literal IPs are checked, including alternate notations (decimal, hex) normalized by the URL parser; DNS is not resolved, so public hostnames pointing at private IPs are not caught.

## Content quality detection

Each fetcher result is scored for quality. Automatic fail on:

- CAPTCHA / Cloudflare challenges
- Login walls
- HTTP error pages in body
- Content under 200 characters

## Requirements

- Node.js >= 20
- No API keys required for basic use
