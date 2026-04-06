import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "@truto/turndown-plugin-gfm";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});
turndown.use(gfm);

export interface PageMeta {
  title: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  description: string;
  author: string;
  publishedTime: string;
}

export function htmlToText(html: string): string {
  if (!html) return "";

  // Try Readability first (handles all frameworks: Next.js, Ghost, WordPress, etc.)
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();
    if (article?.textContent) {
      const text = article.textContent
        .replace(/[^\S\n]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (text.length >= 200) return text;
    }
  } catch { /* fall through to regex */ }

  // Regex fallback for pages Readability can't parse
  return regexHtmlToText(html);
}

export function htmlToMarkdown(html: string): string {
  if (!html) return "";

  // Try Readability first — it returns article.content as clean HTML
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();
    if (article?.content) {
      const md = turndown.turndown(article.content).trim();
      if (md.length >= 200) return md;
    }
  } catch { /* fall through to regex + turndown */ }

  // Regex fallback: strip noise, then convert remaining HTML to Markdown
  let text = html;
  const articleMatch = text.match(/<article[\s>][\s\S]*?<\/article>/i)
    ?? text.match(/<main[\s>][\s\S]*?<\/main>/i);
  if (articleMatch) text = articleMatch[0];

  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, "");

  try {
    return turndown.turndown(text).trim();
  } catch {
    return htmlToText(html);
  }
}

function regexHtmlToText(html: string): string {
  let text = html;
  const articleMatch = text.match(/<article[\s>][\s\S]*?<\/article>/i)
    ?? text.match(/<main[\s>][\s\S]*?<\/main>/i);
  if (articleMatch) text = articleMatch[0];

  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, "");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n\n");
  text = text.replace(/<[^>]+>/g, "");

  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));

  text = text.replace(/[^\S\n]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

function getMetaContent(html: string, property: string, attr: string = "property"): string {
  const regex = new RegExp(
    `<meta\\s+(?:[^>]*?${attr}="${property}"[^>]*?content="([^"]*)"[^>]*?|[^>]*?content="([^"]*)"[^>]*?${attr}="${property}"[^>]*?)\\s*/?>`,
    "i"
  );
  const match = html.match(regex);
  return match ? (match[1] || match[2] || "") : "";
}

export function extractMeta(html: string): PageMeta {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  return {
    title: titleMatch ? titleMatch[1].trim() : "",
    ogTitle: getMetaContent(html, "og:title"),
    ogDescription: getMetaContent(html, "og:description"),
    ogImage: getMetaContent(html, "og:image"),
    description: getMetaContent(html, "description", "name"),
    author: getMetaContent(html, "article:author"),
    publishedTime: getMetaContent(html, "article:published_time"),
  };
}
