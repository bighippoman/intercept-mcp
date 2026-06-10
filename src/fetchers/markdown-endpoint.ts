import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

/**
 * Ask the site for a machine-readable version of the page. Modern docs
 * frameworks (Mintlify, Docusaurus, Fumadocs, many SSGs) serve the raw
 * markdown source at `<path>.md`, and some servers content-negotiate
 * markdown via the Accept header. This is native, clean markdown — and
 * often served from a different code path than the HTML page, so it can
 * succeed when the rendered page is blocked or JS-gated.
 */

const ACCEPT = "text/markdown, text/x-markdown, text/plain;q=0.9";

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 200).toLowerCase().trimStart();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<?xml");
}

function looksLikeMarkdown(text: string): boolean {
  // Headings, list items, fenced code, links, or front matter — anything
  // that distinguishes real markdown from an incidental text/plain blob.
  return /^#{1,6}\s/m.test(text) || /^[-*]\s/m.test(text) || /^```/m.test(text) || /\[[^\]]+\]\([^)]+\)/.test(text) || /^---\n/.test(text);
}

function isUsableMarkdown(text: string, contentType: string): boolean {
  if (!text || text.length < 200) return false;
  if (looksLikeHtml(text)) return false;
  if (/text\/html|application\/(json|xml)/i.test(contentType)) return false;
  if (/markdown/i.test(contentType)) return true;
  // text/plain (or unlabeled): require it to actually look like markdown.
  return looksLikeMarkdown(text);
}

/** Build the `<path>.md` variant of a URL, or null if it doesn't apply. */
function mdVariant(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.search) return null; // query-driven pages rarely have a .md twin
    let path = url.pathname.replace(/\/$/, "");
    if (!path || path === "") return null;
    if (/\.(md|markdown|mdx|txt|json|xml|rss|atom|pdf)$/i.test(path)) return null;
    url.pathname = path + ".md";
    return url.toString();
  } catch {
    return null;
  }
}

async function tryFetch(target: string, headers: Record<string, string>): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(target, { headers }, 8_000);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    return isUsableMarkdown(text, contentType) ? text : null;
  } catch {
    return null;
  }
}

export const markdownEndpointFetcher: Fetcher = {
  name: "markdown-endpoint",
  tier: 3,
  async fetch(url: string): Promise<FetchResult | null> {
    const start = Date.now();

    const variant = mdVariant(url);
    const attempts: Array<Promise<string | null>> = [
      tryFetch(url, { Accept: ACCEPT }),
    ];
    if (variant) attempts.push(tryFetch(variant, { Accept: ACCEPT }));

    const results = await Promise.all(attempts);
    const markdown = results.find((r): r is string => r !== null);
    if (!markdown) return null;

    const content = markdown.trim();
    return {
      content,
      source: "markdown-endpoint",
      quality: scoreContent(content),
      timing: Date.now() - start,
    };
  },
};
