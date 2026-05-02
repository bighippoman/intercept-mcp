/**
 * Stress test: search + fetch 2000 pages through agentsweb.org
 * Tests the full pipeline: search → fetch → cache → verify
 *
 * Usage: ADMIN_SECRET=xxx npx tsx scripts/stress-test.ts
 */

const BASE = "https://agentsweb.org";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const BATCH_SIZE = 3; // concurrent research calls
const DELAY = 2000; // ms between batches

// 100 diverse search queries across many domains
const QUERIES = [
  // Programming
  "python list comprehension tutorial",
  "javascript async await explained",
  "rust ownership borrow checker",
  "go goroutines channels",
  "typescript generics advanced",
  "c++ smart pointers",
  "java stream api examples",
  "kotlin coroutines guide",
  "swift concurrency async",
  "ruby on rails getting started",
  "php laravel eloquent",
  "css grid layout tutorial",
  "html semantic elements",
  "sql join types explained",
  "graphql schema design",
  "rest api best practices",
  "websocket real time",
  "docker compose tutorial",
  "kubernetes deployment yaml",
  "terraform aws infrastructure",
  // AI/ML
  "transformer architecture explained",
  "fine tuning llm guide",
  "rag retrieval augmented generation",
  "prompt engineering techniques",
  "langchain agents tutorial",
  "pytorch neural network",
  "tensorflow keras tutorial",
  "hugging face transformers",
  "stable diffusion how it works",
  "reinforcement learning basics",
  // Web frameworks
  "nextjs app router tutorial",
  "react hooks useEffect",
  "vue composition api",
  "svelte tutorial beginners",
  "angular signals guide",
  "astro static site generator",
  "remix loader action",
  "nuxt server routes",
  "express middleware guide",
  "fastapi python tutorial",
  // Databases
  "postgresql indexing performance",
  "mongodb aggregation pipeline",
  "redis caching strategies",
  "sqlite full text search",
  "prisma orm tutorial",
  "drizzle orm guide",
  "supabase real time",
  "firebase firestore rules",
  // DevOps
  "github actions workflow",
  "nginx reverse proxy config",
  "cloudflare workers tutorial",
  "aws lambda function",
  "vercel deployment guide",
  "fly io deploy app",
  // Security
  "oauth2 flow explained",
  "jwt token authentication",
  "cors explained simply",
  "xss prevention guide",
  "sql injection prevention",
  "content security policy",
  // Science
  "quantum computing basics",
  "crispr gene editing",
  "nuclear fusion progress",
  "mars exploration missions",
  "climate change data 2025",
  "james webb telescope discoveries",
  // Business/Tech
  "startup funding stages",
  "saas pricing strategies",
  "product market fit",
  "technical debt management",
  "microservices vs monolith",
  "event driven architecture",
  // Math
  "linear algebra machine learning",
  "calculus optimization gradient descent",
  "probability bayes theorem",
  "statistics hypothesis testing",
  // General knowledge
  "how does dns work",
  "how does https work",
  "how does tcp ip work",
  "how does wifi work",
  "how does bluetooth work",
  "history of the internet",
  "unicode encoding explained",
  "regex tutorial beginners",
  "git rebase vs merge",
  "vim tutorial beginners",
  // Trending
  "claude code tutorial",
  "cursor ai editor",
  "mcp model context protocol",
  "apple intelligence features",
  "openai gpt 5",
  "anthropic claude opus",
  "google gemini api",
  "llama 3 meta",
  "mistral ai models",
  "deepseek coder",
];

interface Stats {
  totalSearches: number;
  totalResults: number;
  totalCached: number;
  totalFresh: number;
  totalFiltered: number;
  totalFetchFailed: number;
  totalSearchFailed: number;
  searchSources: Record<string, number>;
  fetchSources: Record<string, number>;
  filterReasons: Record<string, number>;
  avgResultsPerSearch: number;
  cacheHitRate: number;
  errors: string[];
}

const stats: Stats = {
  totalSearches: 0,
  totalResults: 0,
  totalCached: 0,
  totalFresh: 0,
  totalFiltered: 0,
  totalFetchFailed: 0,
  totalSearchFailed: 0,
  searchSources: {},
  fetchSources: {},
  filterReasons: {},
  avgResultsPerSearch: 0,
  cacheHitRate: 0,
  errors: [],
};

async function research(query: string): Promise<void> {
  try {
    const headers: Record<string, string> = { };
    if (ADMIN_SECRET) headers["Authorization"] = `Bearer ${ADMIN_SECRET}`;

    const resp = await fetch(
      `${BASE}/research?q=${encodeURIComponent(query)}&count=3`,
      { signal: AbortSignal.timeout(60_000), headers }
    );

    const data = (await resp.json()) as {
      results?: Array<{ title: string; url: string; source: string; markdown: string | null }>;
      error?: string;
      query?: string;
    };

    if (data.error || !data.results) {
      stats.totalSearchFailed++;
      stats.errors.push(`SEARCH FAIL: "${query}" → ${data.error || "no results"}`);
      console.log(`  SEARCH FAIL  ${query} → ${data.error || "no results"}`);
      return;
    }

    stats.totalSearches++;
    stats.totalResults += data.results.length;

    for (const r of data.results) {
      if (r.source.startsWith("cache")) {
        stats.totalCached++;
        stats.fetchSources["cache"] = (stats.fetchSources["cache"] || 0) + 1;
      } else if (r.source.startsWith("fresh")) {
        stats.totalFresh++;
        const src = r.source.match(/\((.+)\)/)?.[1] || "unknown";
        stats.fetchSources[src] = (stats.fetchSources[src] || 0) + 1;
      } else if (r.source === "filtered") {
        stats.totalFiltered++;
        stats.filterReasons["filtered"] = (stats.filterReasons["filtered"] || 0) + 1;
      } else if (r.source === "fetch failed") {
        stats.totalFetchFailed++;
        stats.fetchSources["failed"] = (stats.fetchSources["failed"] || 0) + 1;
      } else {
        stats.fetchSources[r.source] = (stats.fetchSources[r.source] || 0) + 1;
      }
    }

    const cached = data.results.filter((r) => r.source.startsWith("cache")).length;
    const fresh = data.results.filter((r) => r.source.startsWith("fresh")).length;
    const failed = data.results.filter((r) => r.source === "fetch failed" || r.source === "filtered").length;

    console.log(`  ${cached}c ${fresh}f ${failed}x  ${query}`);
  } catch (e) {
    stats.totalSearchFailed++;
    stats.errors.push(`ERROR: "${query}" → ${(e as Error).message}`);
    console.log(`  ERROR  ${query} → ${(e as Error).message}`);
  }
}

async function main() {
  console.log(`\nStress testing ${QUERIES.length} queries × 3 results = ~${QUERIES.length * 3} pages\n`);
  console.log(`Format: [cached]c [fresh]f [failed]x  query\n`);

  const startTime = Date.now();

  for (let i = 0; i < QUERIES.length; i += BATCH_SIZE) {
    const batch = QUERIES.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((q) => research(q)));
    if (i + BATCH_SIZE < QUERIES.length) {
      await new Promise((r) => setTimeout(r, DELAY));
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Calculate final stats
  stats.avgResultsPerSearch = stats.totalSearches > 0 ? +(stats.totalResults / stats.totalSearches).toFixed(1) : 0;
  const totalFetchAttempts = stats.totalCached + stats.totalFresh + stats.totalFiltered + stats.totalFetchFailed;
  stats.cacheHitRate = totalFetchAttempts > 0 ? +((stats.totalCached / totalFetchAttempts) * 100).toFixed(1) : 0;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`STRESS TEST RESULTS (${elapsed}s)`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Queries:          ${QUERIES.length}`);
  console.log(`Successful:       ${stats.totalSearches}`);
  console.log(`Search failed:    ${stats.totalSearchFailed}`);
  console.log(`Total results:    ${stats.totalResults}`);
  console.log(`Avg results/q:    ${stats.avgResultsPerSearch}`);
  console.log(`\nFetch outcomes:`);
  console.log(`  Cached:         ${stats.totalCached}`);
  console.log(`  Fresh:          ${stats.totalFresh}`);
  console.log(`  Filtered:       ${stats.totalFiltered}`);
  console.log(`  Fetch failed:   ${stats.totalFetchFailed}`);
  console.log(`  Cache hit rate: ${stats.cacheHitRate}%`);
  console.log(`\nFetch sources:`);
  for (const [k, v] of Object.entries(stats.fetchSources).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    for (const e of stats.errors.slice(0, 20)) {
      console.log(`  ${e}`);
    }
    if (stats.errors.length > 20) console.log(`  ... and ${stats.errors.length - 20} more`);
  }

  // Check agentsweb stats
  const siteStats = await fetch(`${BASE}/stats`).then((r) => r.json());
  console.log(`\nagentsweb.org stats:`, JSON.stringify(siteStats));
}

main();
