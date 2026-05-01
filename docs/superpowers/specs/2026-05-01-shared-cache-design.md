# Shared Markdown Cache for intercept-mcp

**Date:** 2026-05-01
**Status:** Draft

## Problem

Every AI agent independently fetches the same web pages, fights the same captchas, and converts the same HTML to markdown. This is massively redundant, slow, and fragile. The web isn't markdown-friendly, and agents waste tokens and time re-doing work that another agent already completed seconds ago.

## Solution

A centralized, globally-distributed shared cache of web pages converted to clean markdown. Any intercept-mcp instance can read from it and contribute to it. The cache is self-healing: poisoned or stale entries are automatically corrected by subsequent readers.

Think of it as a "markdown CDN for AI" — the web, pre-processed and cached at the edge.

## Architecture

### Infrastructure

- **Cloudflare Worker** — Single public API endpoint (`cache.intercept.dev` or similar)
- **Cloudflare KV** — Primary store for URL-to-markdown mappings (globally replicated, sub-50ms reads)
- **Cloudflare R2** — Overflow for pages exceeding KV's 25MB value limit

### Data Model

Each cached entry in KV:

```
Key: sha256(normalized_url)

Value: {
  url: string,              // original normalized URL
  markdown: string,          // clean markdown content
  trust_level: number,       // 1 = single source, 2+ = confirmed by N sources
  source: string,            // which fetcher produced this (jina, arquivo, etc.)
  created_at: number,        // unix timestamp
  updated_at: number,        // last confirmation or update
  content_hash: string,      // sha256 of markdown (for fast comparison)
  size: number,              // byte length of markdown
}
```

KV metadata (stored in KV's metadata field, queryable without reading the value):

```
{
  trust_level: number,
  updated_at: number,
  size: number,
}
```

### TTL Strategy

- Trust level 1: 24 hours
- Trust level 2-4: 7 days
- Trust level 5+: 30 days
- News domains (bloomberg.com, nytimes.com, etc.): max 24 hours regardless of trust
- Static content (wikipedia, arxiv, docs): 30 days regardless of trust

## API

### Read: `GET /`

```
GET /?url=https://www.bloomberg.com/article
```

Response (cache hit):
```json
{
  "url": "https://www.bloomberg.com/article",
  "markdown": "# Article Title\n\nArticle content...",
  "trust_level": 3,
  "source": "arquivo",
  "age_seconds": 1842
}
```

Response (cache miss):
```json
{
  "status": "miss"
}
```

Cache miss returns 204 No Content with the JSON body to keep it lightweight.

### Write: `PUT /`

```
PUT /
Content-Type: application/json

{
  "url": "https://www.bloomberg.com/article",
  "markdown": "# Article Title\n\nArticle content...",
  "source": "jina",
  "instance_id": "a1b2c3"  // anonymous, persistent per install
}
```

Response:
```json
{
  "status": "accepted",
  "trust_level": 1
}
```

Or if it confirms an existing entry:
```json
{
  "status": "confirmed",
  "trust_level": 2
}
```

### Confirm: `POST /confirm`

Called by readers whose local pipeline verified the cached content matches.

```
POST /confirm
Content-Type: application/json

{
  "url": "https://www.bloomberg.com/article",
  "content_hash": "abc123...",
  "instance_id": "d4e5f6"
}
```

If the reader's content_hash matches the cached content_hash, trust_level is incremented. If it doesn't match, the reader can submit a replacement via PUT.

## Self-Healing Mechanism

This is the core defense against poisoning.

### Write Path

```
Incoming write
  │
  ├─ Content gates (reject obvious garbage)
  │   ├─ Length < 200 chars → reject
  │   ├─ Contains captcha/login wall indicators → reject
  │   ├─ Contains prompt injection patterns → reject
  │   └─ Pass → continue
  │
  ├─ URL already cached?
  │   ├─ NO → store with trust_level: 1
  │   └─ YES → compare content_hash
  │       ├─ MATCH → increment trust_level
  │       └─ MISMATCH → keep existing if trust_level >= 2,
  │                      replace if existing trust_level == 1
  │
  └─ Done
```

### Read Path

```
Incoming read
  │
  ├─ Cache hit?
  │   ├─ NO → return 204 (miss)
  │   └─ YES → return cached markdown with trust_level
  │
  └─ Reader's local intercept instance (async, after returning cached result):
      ├─ Fetches URL through its own pipeline
      ├─ Compares local result to cached result
      ├─ MATCH → POST /confirm (trust_level++)
      └─ MISMATCH → PUT / with correct content (replaces if trust_level == 1,
                     or flags if trust_level >= 2)
```

### Why Poison Self-Destructs

1. Attacker submits poisoned markdown for a URL. Stored at trust_level 1.
2. First legitimate reader gets the poisoned content BUT also fetches locally.
3. Local fetch produces different content. Reader submits the correct version via PUT.
4. Since the poisoned entry was trust_level 1, it gets replaced immediately.
5. The poison survived exactly one read.

For entries at trust_level 2+, a single contradicting reader doesn't replace — it flags for review. This prevents an attacker from overwriting battle-tested entries.

## Content Gates (Write-Time Validation)

Cheap checks that run on the Worker before accepting a write:

1. **Minimum length**: Reject if markdown < 200 characters
2. **Maximum length**: Reject if markdown > 500KB (likely not article content)
3. **Captcha detection**: Reject if first 500 chars match captcha/challenge patterns
4. **Login wall detection**: Reject if content matches "sign in to continue" patterns
5. **Prompt injection scan**: Reject if content contains patterns like:
   - `ignore previous instructions`
   - `system:` or `<system>` at start of lines
   - `you are now` / `act as` / `pretend to be`
   - Excessive base64-encoded blocks
6. **Domain plausibility**: Reject if markdown contains zero references to the URL's domain or topic (crude check: domain name should appear somewhere in the content)

These gates don't need to be perfect. They filter the obvious garbage. The self-healing mechanism handles the rest.

## Integration with intercept-mcp

### Changes to the Local Pipeline

The shared cache becomes **tier 0** — checked before anything else:

```
Tier 0: Shared cache (GET cache.intercept.dev/?url=...)
Tier 1: Cloudflare Browser Run, Jina Reader
Tier 2: Wayback, archive.ph, Google Cache, Arquivo.pt, Codetabs
Tier 3: Raw fetch, Stealth fetch
Tier 4: RSS, CrossRef, Semantic Scholar, HN, Reddit
Tier 5: OG Meta
```

After the pipeline completes (regardless of which tier succeeded), the result is contributed back to the shared cache asynchronously (fire-and-forget POST, doesn't block the response to the agent).

### Instance ID

Each intercept-mcp install generates a random persistent ID on first run (stored in a local file or environment). This ID is sent with writes and confirmations. It's anonymous — no identifying information — but allows the cache to:

- Deduplicate (same instance confirming its own write doesn't count)
- Track contribution patterns (for future reputation scoring)

### Opt-In/Opt-Out

The shared cache is **enabled by default** for reads. Contributing writes is also on by default but can be disabled:

```
INTERCEPT_SHARED_CACHE=false    # disable both read and write
INTERCEPT_CACHE_READ_ONLY=true  # read from cache, don't contribute
```

### Response Format

When serving cached content, the pipeline footer indicates it:

```
Article content here...

---
source: cache (arquivo, trust:3) | 42ms | cache ✓
```

## Legal Considerations

### Position

intercept-mcp's shared cache operates as an AI infrastructure layer, not a content distribution service. It is analogous to Google Cache, CDN caches, and browser caches — all of which store and serve copies of web content as part of normal internet infrastructure.

### Safeguards

1. **robots.txt compliance**: Before caching a URL, check if the domain's robots.txt disallows caching. Respect `noarchive`, `nosnippet`, and `nocache` meta directives.
2. **DMCA takedown**: Provide a mechanism for content owners to request removal of cached content. Respond within 24 hours.
3. **No substitution intent**: The cache serves AI agents processing content, not humans reading articles. It is transformative infrastructure.
4. **Expiration**: All cached content expires. Nothing is stored permanently.
5. **Attribution**: Every cached entry preserves the source URL. The cache always points back to the original.

### Domains to Exclude by Default

Sites that have actively litigated against caching/scraping:

- No blanket exclusions at launch, but respect robots.txt
- Maintain a blocklist that can be updated without redeployment (stored in KV)
- Honor `X-Robots-Tag: noarchive` HTTP headers

## Cloudflare Worker Implementation

### Endpoints

```
GET  /?url={url}          → read cache
PUT  /                    → write/update cache entry
POST /confirm             → confirm existing entry (trust_level++)
GET  /stats               → public stats (total entries, hit rate, etc.)
```

### Rate Limiting

- Reads: 1000/min per IP (generous, reads are cheap)
- Writes: 10/min per IP (prevent flooding)
- Confirms: 100/min per IP

### KV Namespace Structure

```
cache:{sha256(url)}       → cached entry (markdown + metadata)
block:{domain}            → blocked domain entry
robots:{domain}           → cached robots.txt parse result (TTL: 24h)
stats:global              → global hit/miss counters
```

## Metrics

Track in KV (or D1 if analytics grow):

- Total cached entries
- Cache hit rate
- Average trust level
- Top contributing sources (jina, arquivo, etc.)
- Poison attempts blocked by content gates
- Self-healing corrections (mismatches that triggered replacement)

Expose at `GET /stats` for transparency.

## Rollout Plan

### Phase 1: Read-Only Public Cache
- Deploy Worker + KV
- Populate cache from a curated crawler (your own infra)
- intercept-mcp instances can read but not write
- Validates the infrastructure and API

### Phase 2: Open Writes with Content Gates
- Enable PUT endpoint
- Content gates active
- Trust levels tracked but all verified content served (trust_level >= 1)
- Monitor for abuse patterns

### Phase 3: Self-Healing Consensus
- Enable the confirm endpoint
- Background verification on read
- Trust-level-aware TTLs
- Instance reputation tracking

### Phase 4: Scale
- Add D1 for analytics
- robots.txt compliance layer
- DMCA takedown endpoint
- Public dashboard at stats page

## Open Questions

1. **Cache key normalization**: Should `www.example.com` and `example.com` be the same cache key? (Probably yes — intercept already normalizes URLs.)
2. **Versioning**: Should we keep previous versions of cached entries for rollback? (Probably not initially — adds complexity.)
3. **Geographic sharding**: KV is globally replicated by default. Is that sufficient or do we need regional routing? (KV should be fine.)
4. **Monetization**: Free tier with rate limits, paid tier for higher throughput? Or fully free? (Start free, revisit at scale.)
