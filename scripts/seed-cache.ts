/**
 * Seed the agentsweb.org shared cache with popular URLs.
 * Uses admin secret to bypass rate limits.
 *
 * Usage: ADMIN_SECRET=xxx npx tsx scripts/seed-cache.ts
 */

const CACHE_URL = "https://agentsweb.org";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";
const BATCH_SIZE = 5; // concurrent fetches
const WRITE_DELAY = 500; // ms between writes (be nice to KV)

const URLS = [
  // Documentation - high value, frequently requested by agents
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
  "https://vuejs.org/guide/introduction.html",
  "https://svelte.dev/docs/introduction",
  "https://angular.dev/overview",
  "https://flask.palletsprojects.com/en/stable/quickstart/",
  "https://spring.io/guides",
  "https://learn.microsoft.com/en-us/dotnet/csharp/tour-of-csharp/",
  "https://kotlinlang.org/docs/getting-started.html",
  "https://www.typescriptlang.org/docs/handbook/intro.html",
  "https://docs.deno.com/runtime/",
  "https://bun.sh/docs",

  // Wikipedia - AI/tech topics agents frequently need
  "https://en.wikipedia.org/wiki/Artificial_intelligence",
  "https://en.wikipedia.org/wiki/Large_language_model",
  "https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)",
  "https://en.wikipedia.org/wiki/Rust_(programming_language)",
  "https://en.wikipedia.org/wiki/TypeScript",
  "https://en.wikipedia.org/wiki/Python_(programming_language)",
  "https://en.wikipedia.org/wiki/Node.js",
  "https://en.wikipedia.org/wiki/JavaScript",
  "https://en.wikipedia.org/wiki/React_(software)",
  "https://en.wikipedia.org/wiki/GraphQL",
  "https://en.wikipedia.org/wiki/WebAssembly",
  "https://en.wikipedia.org/wiki/Kubernetes",
  "https://en.wikipedia.org/wiki/Docker_(software)",
  "https://en.wikipedia.org/wiki/PostgreSQL",
  "https://en.wikipedia.org/wiki/Redis",
  "https://en.wikipedia.org/wiki/Git",

  // arXiv - foundational AI papers
  "https://arxiv.org/abs/1706.03762", // Attention Is All You Need
  "https://arxiv.org/abs/2005.14165", // GPT-3
  "https://arxiv.org/abs/2303.08774", // GPT-4
  "https://arxiv.org/abs/2307.09288", // Llama 2
  "https://arxiv.org/abs/2401.02954", // DeepSeek LLM
  "https://arxiv.org/abs/2203.02155", // InstructGPT
  "https://arxiv.org/abs/2305.18290", // Direct Preference Optimization
  "https://arxiv.org/abs/2210.11416", // Scaling Language Models

  // GitHub READMEs - popular repos
  "https://github.com/anthropics/claude-code",
  "https://github.com/vercel/next.js",
  "https://github.com/facebook/react",
  "https://github.com/denoland/deno",
  "https://github.com/oven-sh/bun",
  "https://github.com/microsoft/TypeScript",
  "https://github.com/tailwindlabs/tailwindcss",
  "https://github.com/sveltejs/svelte",
  "https://github.com/vitejs/vite",
  "https://github.com/astro-build/astro",
  "https://github.com/langchain-ai/langchain",
  "https://github.com/huggingface/transformers",
  "https://github.com/ollama/ollama",
  "https://github.com/supabase/supabase",
  "https://github.com/drizzle-team/drizzle-orm",
  "https://github.com/prisma/prisma",

  // News/tech
  "https://www.bbc.com/news",
  "https://techcrunch.com/",
  "https://www.theverge.com/",
  "https://arstechnica.com/",
  "https://news.ycombinator.com/",
  "https://www.wired.com/",

  // Reference
  "https://example.com",
  "https://www.cloudflare.com/learning/what-is-cloudflare/",
  "https://stripe.com/docs/api",
  "https://platform.openai.com/docs/overview",
];

async function fetchMarkdown(url: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/markdown" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    return text.length >= 200 ? text : null;
  } catch {
    return null;
  }
}

async function writeToCache(url: string, markdown: string): Promise<string> {
  try {
    const resp = await fetch(`${CACHE_URL}/`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(ADMIN_SECRET ? { Authorization: `Bearer ${ADMIN_SECRET}` } : {}),
      },
      body: JSON.stringify({
        url,
        markdown,
        source: "seed",
        instance_id: "seedscript000001",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await resp.json()) as Record<string, unknown>;
    return String(result.status || result.error || "unknown");
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}

async function seedUrl(url: string): Promise<void> {
  const markdown = await fetchMarkdown(url);
  if (!markdown) {
    console.log(`  SKIP ${url}`);
    return;
  }

  const status = await writeToCache(url, markdown);
  console.log(`  ${status.toUpperCase()} ${url} (${markdown.length} chars)`);
}

async function main() {
  if (!ADMIN_SECRET) {
    console.log("WARNING: No ADMIN_SECRET set. Will be subject to rate limits.");
    console.log("Usage: ADMIN_SECRET=xxx npx tsx scripts/seed-cache.ts\n");
  }

  console.log(`Seeding ${URLS.length} URLs to ${CACHE_URL}...\n`);

  // Process in batches for speed
  for (let i = 0; i < URLS.length; i += BATCH_SIZE) {
    const batch = URLS.slice(i, i + BATCH_SIZE);
    // Fetch all in parallel
    const results = await Promise.all(
      batch.map(async (url) => {
        const markdown = await fetchMarkdown(url);
        return { url, markdown };
      })
    );

    // Write sequentially (avoid KV contention)
    for (const { url, markdown } of results) {
      if (!markdown) {
        console.log(`  SKIP ${url}`);
        continue;
      }
      const status = await writeToCache(url, markdown);
      console.log(`  ${status.toUpperCase()} ${url} (${markdown.length} chars)`);
      await new Promise((r) => setTimeout(r, WRITE_DELAY));
    }
  }

  // Final stats
  const stats = await fetch(`${CACHE_URL}/stats`);
  console.log("\nDone.", await stats.json());
}

main();
