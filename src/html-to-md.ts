/**
 * html-to-md: High-quality HTML to Markdown converter
 * Runs natively in Cloudflare Workers — zero npm dependencies.
 *
 * Goals:
 * 1. Extract main content (skip nav, footer, sidebar, ads)
 * 2. Convert to proper markdown (headings, lists, tables, code, links, images)
 * 3. Strip boilerplate (share buttons, cookie banners, related articles)
 * 4. Normalize whitespace
 * 5. Decode all HTML entities
 *
 * NOT YET INTEGRATED — call convertHtmlToMarkdown() directly to test.
 */

// ============================================================
// Content extraction — find the main article
// ============================================================

const CONTENT_SELECTORS = [
  /<article[\s>][\s\S]*?<\/article>/i,
  /<main[\s>][\s\S]*?<\/main>/i,
  /<div[^>]*(?:class|id)="[^"]*(?:post-content|article-content|entry-content|page-content|main-content|content-body|post-body|article-body)[^"]*"[^>]*>[\s\S]*?<\/div>/i,
  /<div[^>]*(?:class|id)="[^"]*(?:markdown-body|prose|rich-text|doc-content|docs-content)[^"]*"[^>]*>[\s\S]*?<\/div>/i,
  /<div[^>]*role="main"[^>]*>[\s\S]*?<\/div>/i,
];

function extractContent(html: string): string {
  // Try progressively less specific selectors
  for (const re of CONTENT_SELECTORS) {
    const match = html.match(re);
    if (match && match[0].length > 500) return match[0];
  }
  // Fallback: use the whole body
  const bodyMatch = html.match(/<body[\s>][\s\S]*?<\/body>/i);
  return bodyMatch ? bodyMatch[0] : html;
}

// ============================================================
// Noise removal — strip everything that isn't content
// ============================================================

function stripNoise(html: string): string {
  let h = html;

  // Remove entire elements that are never content
  const noisePatterns = [
    /<script[\s\S]*?<\/script>/gi,
    /<style[\s\S]*?<\/style>/gi,
    /<nav[\s\S]*?<\/nav>/gi,
    /<footer[\s\S]*?<\/footer>/gi,
    /<header[\s\S]*?<\/header>/gi,
    /<aside[\s\S]*?<\/aside>/gi,
    /<noscript[\s\S]*?<\/noscript>/gi,
    /<svg[\s\S]*?<\/svg>/gi,
    /<button[\s\S]*?<\/button>/gi,
    /<form[\s\S]*?<\/form>/gi,
    /<iframe[\s\S]*?<\/iframe>/gi,
    /<select[\s\S]*?<\/select>/gi,
    /<input[^>]*\/?>/gi,
    /<textarea[\s\S]*?<\/textarea>/gi,
    /<!--[\s\S]*?-->/g,
    /<figcaption[\s\S]*?<\/figcaption>/gi, // keep figure, strip caption noise
  ];

  for (const p of noisePatterns) {
    h = h.replace(p, "");
  }

  // Remove elements by class/id containing noise keywords
  const noiseClasses = [
    /class="[^"]*(?:sidebar|widget|banner|popup|modal|overlay|toast|notification|cookie|consent|share|social|follow|subscribe|newsletter|ad-|advert|promo|related|recommended|trending|popular)[^"]*"/gi,
  ];

  // Remove divs with noise classes (rough but effective)
  for (const p of noiseClasses) {
    // Find opening tags with noise classes, then remove the whole element
    // This is imperfect but catches most cases
    h = h.replace(new RegExp(`<div[^>]*${p.source}[^>]*>[\\s\\S]*?<\\/div>`, "gi"), "");
  }

  return h;
}

// ============================================================
// Entity decoding
// ============================================================

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", mdash: "—", ndash: "–", hellip: "...",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
  bull: "\u2022", middot: "\u00B7", copy: "\u00A9", reg: "\u00AE",
  trade: "\u2122", deg: "\u00B0", times: "\u00D7", divide: "\u00F7",
  laquo: "\u00AB", raquo: "\u00BB", euro: "\u20AC", pound: "\u00A3",
  yen: "\u00A5", cent: "\u00A2", frac12: "\u00BD", frac14: "\u00BC",
  frac34: "\u00BE", para: "\u00B6", sect: "\u00A7", dagger: "\u2020",
  rarr: "\u2192", larr: "\u2190", uarr: "\u2191", darr: "\u2193",
  hearts: "\u2665", clubs: "\u2663", spades: "\u2660", diams: "\u2666",
  infin: "\u221E", prime: "\u2032", le: "\u2264", ge: "\u2265",
  ne: "\u2260", asymp: "\u2248", sum: "\u2211", prod: "\u220F",
  alpha: "\u03B1", beta: "\u03B2", gamma: "\u03B3", delta: "\u03B4",
  pi: "\u03C0", sigma: "\u03C3", omega: "\u03C9",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&([a-zA-Z]+);/g, (_, name) => NAMED_ENTITIES[name.toLowerCase()] ?? `&${name};`)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// ============================================================
// Inline text cleanup — strip tags, normalize whitespace within a line
// ============================================================

function cleanInlineText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

// ============================================================
// Markdown conversion — element by element
// ============================================================

function convertHeadings(html: string): string {
  let h = html;
  for (let level = 1; level <= 6; level++) {
    const prefix = "#".repeat(level);
    const re = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi");
    h = h.replace(re, (_, content) => `\n${prefix} ${cleanInlineText(content)}\n`);
  }
  return h;
}

function convertCodeBlocks(html: string): string {
  let h = html;

  // <pre><code class="language-xxx">...</code></pre>
  h = h.replace(/<pre[^>]*>\s*<code[^>]*class="[^"]*language-(\w+)[^"]*"[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, lang, code) => `\n\`\`\`${lang}\n${decodeEntities(code.replace(/<[^>]+>/g, "")).trim()}\n\`\`\`\n`);

  // <pre><code>...</code></pre>
  h = h.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, code) => `\n\`\`\`\n${decodeEntities(code.replace(/<[^>]+>/g, "")).trim()}\n\`\`\`\n`);

  // <pre>...</pre> (no code tag)
  h = h.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi,
    (_, code) => `\n\`\`\`\n${decodeEntities(code.replace(/<[^>]+>/g, "")).trim()}\n\`\`\`\n`);

  // Inline <code>
  h = h.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi,
    (_, code) => `\`${decodeEntities(code.replace(/<[^>]+>/g, "")).trim()}\``);

  return h;
}

function convertLinks(html: string): string {
  return html.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const cleanText = cleanInlineText(text);
    if (!cleanText) return "";
    // Skip internal anchors and javascript links
    if (href.startsWith("#") || href.startsWith("javascript:")) return cleanText;
    return `[${cleanText}](${href})`;
  });
}

function convertImages(html: string): string {
  let h = html;
  // Images with alt text
  h = h.replace(/<img[^>]+alt="([^"]*)"[^>]+src="([^"]*)"[^>]*\/?>/gi, "![$1]($2)");
  h = h.replace(/<img[^>]+src="([^"]*)"[^>]+alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  // Images without alt text — skip (usually tracking pixels)
  h = h.replace(/<img[^>]*\/?>/gi, "");
  return h;
}

function convertFormatting(html: string): string {
  let h = html;
  h = h.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (_, __, content) => `**${cleanInlineText(content)}**`);
  h = h.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, (_, __, content) => `*${cleanInlineText(content)}*`);
  h = h.replace(/<(del|s|strike)>([\s\S]*?)<\/\1>/gi, (_, __, content) => `~~${cleanInlineText(content)}~~`);
  h = h.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, (_, content) => `==${cleanInlineText(content)}==`);
  h = h.replace(/<u>([\s\S]*?)<\/u>/gi, (_, content) => cleanInlineText(content)); // no MD underline
  h = h.replace(/<sup>([\s\S]*?)<\/sup>/gi, (_, content) => `^${cleanInlineText(content)}`);
  h = h.replace(/<sub>([\s\S]*?)<\/sub>/gi, (_, content) => `~${cleanInlineText(content)}`);
  return h;
}

function convertBlockquotes(html: string): string {
  return html.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const text = cleanInlineText(content);
    return "\n" + text.split("\n").map((l: string) => `> ${l.trim()}`).join("\n") + "\n";
  });
}

function convertLists(html: string): string {
  let h = html;

  // Ordered lists
  h = h.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    let i = 0;
    return "\n" + content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => {
      i++;
      return `${i}. ${cleanInlineText(item)}\n`;
    }) + "\n";
  });

  // Unordered lists
  h = h.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    return "\n" + content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => {
      return `- ${cleanInlineText(item)}\n`;
    }) + "\n";
  });

  // Standalone list items (outside ul/ol)
  h = h.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, item) => `- ${cleanInlineText(item)}\n`);

  return h;
}

function convertTables(html: string): string {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, tableContent) => {
    const rows: string[][] = [];

    // Extract rows
    const rowMatches = tableContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const rowMatch of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rowMatch[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi);
      for (const cellMatch of cellMatches) {
        cells.push(cleanInlineText(cellMatch[1]));
      }
      if (cells.length) rows.push(cells);
    }

    if (!rows.length) return "";

    // Build markdown table
    const colCount = Math.max(...rows.map((r) => r.length));
    const lines: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const padded = rows[i].concat(Array(colCount - rows[i].length).fill(""));
      lines.push("| " + padded.join(" | ") + " |");
      // Add separator after first row (header)
      if (i === 0) {
        lines.push("| " + padded.map(() => "---").join(" | ") + " |");
      }
    }

    return "\n" + lines.join("\n") + "\n";
  });
}

function convertMiscElements(html: string): string {
  let h = html;

  // Horizontal rules
  h = h.replace(/<hr[^>]*\/?>/gi, "\n---\n");

  // Line breaks
  h = h.replace(/<br\s*\/?>/gi, "\n");

  // Definition lists
  h = h.replace(/<dt[^>]*>([\s\S]*?)<\/dt>/gi, (_, term) => `\n**${cleanInlineText(term)}**\n`);
  h = h.replace(/<dd[^>]*>([\s\S]*?)<\/dd>/gi, (_, def) => `: ${cleanInlineText(def)}\n`);

  // Figures
  h = h.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (_, content) => content);

  // Details/Summary
  h = h.replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, (_, text) => `\n**${cleanInlineText(text)}**\n`);
  h = h.replace(/<\/?details[^>]*>/gi, "");

  // Paragraphs and divs → double newline
  h = h.replace(/<\/(p|div|section|article|main)>/gi, "\n\n");

  return h;
}

// ============================================================
// Final cleanup
// ============================================================

function finalCleanup(markdown: string): string {
  let md = markdown;

  // Strip any remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode any remaining entities
  md = decodeEntities(md);

  // Normalize whitespace
  md = md.replace(/[^\S\n]+/g, " "); // collapse spaces (not newlines)
  md = md.replace(/\n{4,}/g, "\n\n\n"); // max 3 consecutive newlines
  md = md.replace(/^\s+$/gm, ""); // empty lines with spaces → truly empty
  md = md.replace(/\n{3,}/g, "\n\n"); // then collapse to 2

  // Fix markdown artifacts
  md = md.replace(/\*\*\s*\*\*/g, ""); // empty bold
  md = md.replace(/\*\s*\*/g, ""); // empty italic
  md = md.replace(/\[\s*\]\(\s*\)/g, ""); // empty links
  md = md.replace(/!\[\s*\]\(\s*\)/g, ""); // empty images

  // Trim each line
  md = md.split("\n").map((l) => l.trimEnd()).join("\n");

  return md.trim();
}

// ============================================================
// Main conversion function
// ============================================================

export function convertHtmlToMarkdown(html: string): string {
  // Step 1: Extract main content
  let content = extractContent(html);

  // Step 2: Strip noise
  content = stripNoise(content);

  // Step 3: Convert elements (order matters — code blocks first to protect content)
  content = convertCodeBlocks(content);
  content = convertTables(content);
  content = convertHeadings(content);
  content = convertBlockquotes(content);
  content = convertLists(content);
  content = convertLinks(content);
  content = convertImages(content);
  content = convertFormatting(content);
  content = convertMiscElements(content);

  // Step 4: Final cleanup
  content = finalCleanup(content);

  return content;
}

// ============================================================
// Extract metadata from HTML
// ============================================================

export function extractHtmlMeta(html: string): {
  title: string;
  description: string;
  author: string;
  publishedTime: string;
  ogImage: string;
} {
  const getMetaContent = (html: string, attr: string, value: string): string => {
    const re = new RegExp(`<meta[^>]*${attr}="${value}"[^>]*content="([^"]*)"`, "i");
    const re2 = new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attr}="${value}"`, "i");
    return (html.match(re)?.[1] || html.match(re2)?.[1] || "").trim();
  };

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  return {
    title: getMetaContent(html, "property", "og:title") || (titleMatch ? decodeEntities(titleMatch[1]).trim() : ""),
    description: getMetaContent(html, "property", "og:description") || getMetaContent(html, "name", "description"),
    author: getMetaContent(html, "name", "author") || getMetaContent(html, "property", "article:author"),
    publishedTime: getMetaContent(html, "property", "article:published_time"),
    ogImage: getMetaContent(html, "property", "og:image"),
  };
}
