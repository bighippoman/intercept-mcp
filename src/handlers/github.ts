import { fetchWithTimeout } from "../fetch-with-timeout.js";
import type { Handler, HandlerResult } from "../types.js";

const API = "https://api.github.com";
const RESERVED_OWNERS = ["settings", "marketplace", "explore", "topics", "trending", "collections", "sponsors", "login", "join", "orgs", "apps", "features", "about", "pricing", "search", "notifications"];

// Unauthenticated GitHub API allows 60 requests/hour. Setting GITHUB_TOKEN
// raises the limit and grants access to private repos the token can see.
function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "intercept-mcp (https://github.com/bighippoman/intercept-mcp)",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const response = await fetchWithTimeout(`${API}${path}`, { headers: apiHeaders() }, 8_000);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", php: "php", sh: "bash", bash: "bash",
  yml: "yaml", yaml: "yaml", json: "json", toml: "toml", xml: "xml", html: "html", css: "css",
  sql: "sql", proto: "proto", tf: "hcl", dockerfile: "dockerfile",
};

const PLAIN_EXTENSIONS = new Set(["md", "markdown", "mdx", "rst", "txt", "adoc"]);

async function fetchReadme(owner: string, repo: string, start: number): Promise<HandlerResult | null> {
  for (const branch of ["HEAD", "main", "master"]) {
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
}

async function fetchFile(owner: string, repo: string, ref: string, path: string, start: number): Promise<HandlerResult | null> {
  try {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
    const response = await fetchWithTimeout(rawUrl, {}, 8_000);
    if (!response.ok) return null;
    const text = await response.text();
    if (!text) return null;

    const filename = path.split("/").pop() ?? path;
    const ext = filename.toLowerCase().includes(".") ? filename.toLowerCase().split(".").pop()! : filename.toLowerCase();
    const header = `# ${owner}/${repo}/${path} (at ${ref})\n\n`;

    if (PLAIN_EXTENSIONS.has(ext)) {
      return { content: header + text, source: "github", timing: Date.now() - start };
    }

    const lang = LANG_BY_EXT[ext] ?? "";
    return {
      content: `${header}\`\`\`${lang}\n${text}\n\`\`\``,
      source: "github",
      timing: Date.now() - start,
    };
  } catch {
    return null;
  }
}

interface IssueData {
  title: string;
  state: string;
  body: string | null;
  user: { login: string } | null;
  created_at: string;
  closed_at: string | null;
  labels: Array<{ name: string }>;
  comments: number;
}

interface PullData extends IssueData {
  merged: boolean;
  base: { ref: string };
  head: { ref: string };
  additions: number;
  deletions: number;
  changed_files: number;
}

interface CommentData {
  user: { login: string } | null;
  created_at: string;
  body: string;
}

async function fetchComments(owner: string, repo: string, num: string): Promise<string[]> {
  const comments = await apiGet<CommentData[]>(`/repos/${owner}/${repo}/issues/${num}/comments?per_page=30`);
  if (!comments || comments.length === 0) return [];
  const parts = ["", "## Comments", ""];
  for (const c of comments) {
    parts.push(`**@${c.user?.login ?? "ghost"}** (${c.created_at}):`);
    parts.push(c.body || "*(no text)*");
    parts.push("");
  }
  return parts;
}

async function fetchIssue(owner: string, repo: string, num: string, start: number): Promise<HandlerResult | null> {
  const issue = await apiGet<IssueData>(`/repos/${owner}/${repo}/issues/${num}`);
  if (!issue) return null;

  const parts = [
    `# ${issue.title}`,
    `${owner}/${repo}#${num} · **${issue.state}** · opened by @${issue.user?.login ?? "ghost"} on ${issue.created_at}`,
  ];
  if (issue.labels.length) parts.push(`Labels: ${issue.labels.map((l) => l.name).join(", ")}`);
  parts.push("", issue.body || "*(no description)*");
  parts.push(...(await fetchComments(owner, repo, num)));

  return { content: parts.join("\n"), source: "github", timing: Date.now() - start };
}

async function fetchPull(owner: string, repo: string, num: string, start: number): Promise<HandlerResult | null> {
  const pr = await apiGet<PullData>(`/repos/${owner}/${repo}/pulls/${num}`);
  if (!pr) return null;

  const state = pr.merged ? "merged" : pr.state;
  const parts = [
    `# ${pr.title}`,
    `${owner}/${repo}#${num} · **${state}** · ${pr.head.ref} → ${pr.base.ref} · opened by @${pr.user?.login ?? "ghost"} on ${pr.created_at}`,
    `+${pr.additions} −${pr.deletions} across ${pr.changed_files} files`,
  ];
  if (pr.labels.length) parts.push(`Labels: ${pr.labels.map((l) => l.name).join(", ")}`);
  parts.push("", pr.body || "*(no description)*");
  parts.push(...(await fetchComments(owner, repo, num)));

  return { content: parts.join("\n"), source: "github", timing: Date.now() - start };
}

interface ReleaseData {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string;
  prerelease: boolean;
}

async function fetchRelease(owner: string, repo: string, tag: string | null, start: number): Promise<HandlerResult | null> {
  const path = tag
    ? `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`
    : `/repos/${owner}/${repo}/releases/latest`;
  const release = await apiGet<ReleaseData>(path);
  if (!release) return null;

  const parts = [
    `# ${release.name || release.tag_name}`,
    `${owner}/${repo} release **${release.tag_name}**${release.prerelease ? " (pre-release)" : ""} · published ${release.published_at}`,
    "",
    release.body || "*(no release notes)*",
  ];

  return { content: parts.join("\n"), source: "github", timing: Date.now() - start };
}

export const githubHandler: Handler = {
  name: "github",
  patterns: [
    /github\.com\/[^\/]+\/[^\/]+\/?$/,
    /github\.com\/[^\/]+\/[^\/]+\/(?:blob|raw)\/[^\/]+\/.+/,
    /github\.com\/[^\/]+\/[^\/]+\/issues\/\d+\/?$/,
    /github\.com\/[^\/]+\/[^\/]+\/pull\/\d+\/?$/,
    /github\.com\/[^\/]+\/[^\/]+\/releases\/(?:tag\/[^\/]+|latest)\/?$/,
  ],
  async handle(url: string): Promise<HandlerResult | null> {
    const start = Date.now();

    let pathname: string;
    try {
      const parsed = new URL(url);
      if (!/(^|\.)github\.com$/.test(parsed.hostname)) return null;
      pathname = decodeURIComponent(parsed.pathname).replace(/\/$/, "");
    } catch {
      return null;
    }

    const file = pathname.match(/^\/([^\/]+)\/([^\/]+)\/(?:blob|raw)\/([^\/]+)\/(.+)$/);
    if (file) return fetchFile(file[1], file[2], file[3], file[4], start);

    const issue = pathname.match(/^\/([^\/]+)\/([^\/]+)\/issues\/(\d+)$/);
    if (issue) return fetchIssue(issue[1], issue[2], issue[3], start);

    const pull = pathname.match(/^\/([^\/]+)\/([^\/]+)\/pull\/(\d+)$/);
    if (pull) return fetchPull(pull[1], pull[2], pull[3], start);

    const releaseTag = pathname.match(/^\/([^\/]+)\/([^\/]+)\/releases\/tag\/([^\/]+)$/);
    if (releaseTag) return fetchRelease(releaseTag[1], releaseTag[2], releaseTag[3], start);

    const releaseLatest = pathname.match(/^\/([^\/]+)\/([^\/]+)\/releases\/latest$/);
    if (releaseLatest) return fetchRelease(releaseLatest[1], releaseLatest[2], null, start);

    const repo = pathname.match(/^\/([^\/]+)\/([^\/]+)$/);
    if (repo && !RESERVED_OWNERS.includes(repo[1])) return fetchReadme(repo[1], repo[2], start);

    return null;
  },
};
