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

  // Try to extract article/main content area first
  let text = html;
  const articleMatch = text.match(/<article[\s>][\s\S]*?<\/article>/i)
    ?? text.match(/<main[\s>][\s\S]*?<\/main>/i);
  if (articleMatch) text = articleMatch[0];

  // Strip non-content elements
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "");
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<svg[\s\S]*?<\/svg>/gi, "");

  // Structural replacements
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n\n");

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));

  // Normalize whitespace
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
