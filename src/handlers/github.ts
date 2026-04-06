import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { Handler, HandlerResult } from "../types.js";

function extractRepoPath(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+?)\/?$/);
  if (!match) return null;
  const reserved = ["settings", "marketplace", "explore", "topics", "trending", "collections", "sponsors", "login", "join"];
  if (reserved.includes(match[1])) return null;
  return { owner: match[1], repo: match[2] };
}

const BRANCHES = ["HEAD", "main", "master"];

export const githubHandler: Handler = {
  name: "github",
  patterns: [/github\.com\/[^\/]+\/[^\/]+\/?$/],
  async handle(url: string): Promise<HandlerResult | null> {
    const start = Date.now();
    const parsed = extractRepoPath(url);
    if (!parsed) return null;

    const { owner, repo } = parsed;

    for (const branch of BRANCHES) {
      try {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
        const response = await fetchWithTimeout(rawUrl, {}, 8_000);
        if (!response.ok) continue;
        const content = await response.text();
        if (content.length < 50) continue;

        return {
          content: `# ${owner}/${repo}\n\n${content}`,
          source: "github",
          timing: Date.now() - start,
        };
      } catch {
        continue;
      }
    }

    return null;
  },
};
