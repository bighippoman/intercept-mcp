/**
 * Re-seed URLs that failed via Jina by using intercept's full pipeline.
 * Usage: ADMIN_SECRET=xxx npx tsx scripts/seed-retry.ts
 */

const CACHE_URL = "https://agentsweb.org";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

const URLS = [
  // Wikipedia (use Wikipedia API directly)
  "https://en.wikipedia.org/wiki/Artificial_intelligence",
  "https://en.wikipedia.org/wiki/Large_language_model",
  "https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)",
  "https://en.wikipedia.org/wiki/Rust_(programming_language)",
  "https://en.wikipedia.org/wiki/TypeScript",
  "https://en.wikipedia.org/wiki/Python_(programming_language)",
  "https://en.wikipedia.org/wiki/JavaScript",
  "https://en.wikipedia.org/wiki/React_(software)",
  "https://en.wikipedia.org/wiki/Kubernetes",
  "https://en.wikipedia.org/wiki/Docker_(software)",
  "https://en.wikipedia.org/wiki/PostgreSQL",
  "https://en.wikipedia.org/wiki/Git",

  // arXiv (use arXiv API directly)
  "https://arxiv.org/abs/1706.03762",
  "https://arxiv.org/abs/2005.14165",
  "https://arxiv.org/abs/2303.08774",
  "https://arxiv.org/abs/2307.09288",
  "https://arxiv.org/abs/2401.02954",

  // GitHub (use raw README)
  "https://github.com/anthropics/claude-code",
  "https://github.com/microsoft/TypeScript",
  "https://github.com/langchain-ai/langchain",
  "https://github.com/huggingface/transformers",
  "https://github.com/ollama/ollama",
  "https://github.com/supabase/supabase",
  "https://github.com/prisma/prisma",

  // Docs that had false positive malicious content detection (now fixed)
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide",
  "https://fastapi.tiangolo.com/tutorial/",
  "https://vuejs.org/guide/introduction.html",
  "https://svelte.dev/docs/introduction",
  "https://flask.palletsprojects.com/en/stable/quickstart/",
];

async function fetchWikipedia(title: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(title)}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!resp.ok) return null;
    // Just get the text content
    const html = await resp.text();
    // Simple HTML to text conversion
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 200 ? `# ${title.replace(/_/g, " ")}\n\n${text.slice(0, 50000)}` : null;
  } catch { return null; }
}

async function fetchArxiv(id: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `https://export.arxiv.org/api/query?id_list=${id}`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!resp.ok) return null;
    const xml = await resp.text();
    const title = xml.match(/<title[^>]*>([\s\S]*?)<\/title>/g)?.[1]?.replace(/<[^>]+>/g, "").trim() || id;
    const summary = xml.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]?.trim() || "";
    const authors = [...xml.matchAll(/<name>([\s\S]*?)<\/name>/g)].map(m => m[1].trim()).join(", ");
    return `# ${title}\n**Authors:** ${authors}\n**arXiv:** ${id}\n\n## Abstract\n${summary}`;
  } catch { return null; }
}

async function fetchGithub(owner: string, repo: string): Promise<string | null> {
  try {
    const resp = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`,
      { signal: AbortSignal.timeout(10_000) }
    );
    if (!resp.ok) return null;
    const text = await resp.text();
    return text.length > 200 ? text : null;
  } catch { return null; }
}

async function fetchJina(url: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/markdown" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    return text.length >= 200 ? text : null;
  } catch { return null; }
}

async function writeToCache(url: string, markdown: string): Promise<string> {
  try {
    const resp = await fetch(`${CACHE_URL}/`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(ADMIN_SECRET ? { Authorization: `Bearer ${ADMIN_SECRET}` } : {}),
      },
      body: JSON.stringify({ url, markdown, source: "seed", instance_id: "seedretry000001" }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await resp.json()) as Record<string, unknown>;
    return String(result.status || result.error || "unknown");
  } catch (e) { return `error: ${(e as Error).message}`; }
}

async function main() {
  console.log(`Retrying ${URLS.length} URLs...\n`);

  for (const url of URLS) {
    let markdown: string | null = null;

    if (url.includes("wikipedia.org/wiki/")) {
      const title = url.split("/wiki/")[1];
      markdown = await fetchWikipedia(title);
    } else if (url.includes("arxiv.org/abs/")) {
      const id = url.split("/abs/")[1];
      markdown = await fetchArxiv(id);
    } else if (url.match(/github\.com\/([^/]+)\/([^/]+)$/)) {
      const [, owner, repo] = url.match(/github\.com\/([^/]+)\/([^/]+)$/)!;
      markdown = await fetchGithub(owner, repo);
    } else {
      markdown = await fetchJina(url);
    }

    if (!markdown) {
      console.log(`  SKIP ${url}`);
      continue;
    }

    const status = await writeToCache(url, markdown);
    console.log(`  ${status.toUpperCase()} ${url} (${markdown.length} chars)`);
    await new Promise((r) => setTimeout(r, 300));
  }

  const stats = await fetch(`${CACHE_URL}/stats`);
  console.log("\nDone.", await stats.json());
}

main();
