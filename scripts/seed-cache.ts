/**
 * Seed the agentsweb.org shared cache with popular URLs.
 * Fetches each URL through intercept's pipeline and pushes the result to the cache.
 *
 * Usage: npx tsx scripts/seed-cache.ts
 */

const CACHE_URL = "https://agentsweb.org";

const URLS = [
  // Documentation
  "https://docs.python.org/3/tutorial/index.html",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide",
  "https://doc.rust-lang.org/book/",
  "https://go.dev/doc/",
  "https://react.dev/learn",
  "https://nextjs.org/docs",
  "https://docs.astro.build/en/getting-started/",
  "https://tailwindcss.com/docs/installation",
  "https://expressjs.com/en/guide/routing.html",
  "https://fastapi.tiangolo.com/tutorial/",
  "https://docs.djangoproject.com/en/5.2/intro/tutorial01/",

  // Wikipedia
  "https://en.wikipedia.org/wiki/Artificial_intelligence",
  "https://en.wikipedia.org/wiki/Large_language_model",
  "https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)",
  "https://en.wikipedia.org/wiki/Model_Context_Protocol",
  "https://en.wikipedia.org/wiki/Rust_(programming_language)",
  "https://en.wikipedia.org/wiki/TypeScript",
  "https://en.wikipedia.org/wiki/Python_(programming_language)",
  "https://en.wikipedia.org/wiki/Node.js",

  // arXiv (popular AI papers)
  "https://arxiv.org/abs/1706.03762", // Attention Is All You Need
  "https://arxiv.org/abs/2005.14165", // GPT-3
  "https://arxiv.org/abs/2303.08774", // GPT-4
  "https://arxiv.org/abs/2307.09288", // Llama 2
  "https://arxiv.org/abs/2401.02954", // DeepSeek LLM

  // GitHub READMEs
  "https://github.com/anthropics/claude-code",
  "https://github.com/vercel/next.js",
  "https://github.com/facebook/react",
  "https://github.com/denoland/deno",
  "https://github.com/oven-sh/bun",

  // News / tech blogs
  "https://www.bbc.com/news",
  "https://techcrunch.com/",
  "https://www.theverge.com/",
  "https://arstechnica.com/",
  "https://news.ycombinator.com/",

  // Misc popular pages
  "https://example.com",
  "https://httpbin.org/html",
  "https://www.cloudflare.com/learning/what-is-cloudflare/",
];

async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function seedUrl(url: string): Promise<void> {
  try {
    // Fetch through Jina Reader (simplest, no dependencies)
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/markdown" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.log(`  SKIP ${url} (jina ${resp.status})`);
      return;
    }

    const markdown = await resp.text();
    if (markdown.length < 200) {
      console.log(`  SKIP ${url} (too short: ${markdown.length})`);
      return;
    }

    // Write to shared cache
    const writeResp = await fetch(`${CACHE_URL}/`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        markdown,
        source: "seed",
        instance_id: "seedscript000001",
      }),
      signal: AbortSignal.timeout(5_000),
    });

    const result = await writeResp.json() as Record<string, unknown>;
    console.log(`  ${String(result.status).toUpperCase()} ${url} (${markdown.length} chars)`);
  } catch (e) {
    console.log(`  ERROR ${url}: ${(e as Error).message}`);
  }
}

async function main() {
  console.log(`Seeding ${URLS.length} URLs to ${CACHE_URL}...\n`);

  for (const url of URLS) {
    await seedUrl(url);
    // Small delay to avoid rate limiting on both Jina and agentsweb
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Check stats
  const stats = await fetch(`${CACHE_URL}/stats`);
  const data = await stats.json();
  console.log("\nDone. Stats:", JSON.stringify(data));
}

main();
