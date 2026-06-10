/**
 * Recover article content embedded as JSON in HTML — hydration state
 * (Next.js, Nuxt, Apollo, Remix) and schema.org JSON-LD.
 *
 * SPA pages ship an empty DOM shell that Readability can't read, but the
 * real content is almost always sitting in a <script> blob in the same HTML
 * we already downloaded. Paywalled news pages similarly embed the full
 * articleBody in JSON-LD for SEO even when the visible page is gated. This
 * extracts that content with no rendering and no extra requests.
 *
 * Self-contained by design (no html.ts import) to avoid a circular dependency,
 * so it carries a minimal local HTML stripper for HTML-valued fields.
 */

const ARTICLE_TYPES = /^(Article|NewsArticle|BlogPosting|Report|TechArticle|ScholarlyArticle|MedicalScholarlyArticle|LiveBlogPosting|AdvertiserContentArticle|SatiricalArticle)$/i;

// Keys whose values tend to hold the page's main prose.
const CONTENT_KEY = /^(article)?body(html)?$|^content(html|raw|markdown)?$|^markdown$|^rawbody$|^text$|^bodytext$|^body_?html$|^maincontent$/i;

const MIN_LENGTH = 200;

export function extractEmbeddedContent(html: string): string | null {
  if (!html || html.indexOf("<script") === -1) return null;
  return extractJsonLd(html) ?? extractNextData(html) ?? extractHydrationState(html);
}

/* ------------------------------- JSON-LD -------------------------------- */

function* iterateJsonLd(html: string): Generator<unknown> {
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "").trim();
    if (!raw) continue;
    try {
      yield JSON.parse(raw);
    } catch {
      /* malformed block — skip */
    }
  }
}

function collectObjects(node: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectObjects(n, out);
    return;
  }
  if (node && typeof node === "object") {
    out.push(node as Record<string, unknown>);
    const graph = (node as Record<string, unknown>)["@graph"];
    if (graph) collectObjects(graph, out);
  }
}

function typeMatches(t: unknown): boolean {
  if (typeof t === "string") return ARTICLE_TYPES.test(t);
  if (Array.isArray(t)) return t.some(typeMatches);
  return false;
}

function extractAuthor(author: unknown): string {
  if (typeof author === "string") return author.trim();
  if (Array.isArray(author)) return author.map(extractAuthor).filter(Boolean).join(", ");
  if (author && typeof author === "object") {
    const name = (author as Record<string, unknown>).name;
    if (typeof name === "string") return name.trim();
  }
  return "";
}

function extractJsonLd(html: string): string | null {
  const objs: Record<string, unknown>[] = [];
  for (const data of iterateJsonLd(html)) collectObjects(data, objs);

  let best: { body: string; obj: Record<string, unknown>; typed: boolean } | null = null;
  for (const obj of objs) {
    const raw = obj.articleBody;
    const body = typeof raw === "string" ? raw.trim() : "";
    if (body.length < MIN_LENGTH) continue;
    const typed = typeMatches(obj["@type"]);
    // Prefer a typed Article; among equals, the longest body.
    if (!best || (typed && !best.typed) || (typed === best.typed && body.length > best.body.length)) {
      best = { body, obj, typed };
    }
  }
  if (!best) return null;

  const parts: string[] = [];
  const headline = best.obj.headline ?? best.obj.name;
  if (typeof headline === "string" && headline.trim()) parts.push(`# ${headline.trim()}`);

  const author = extractAuthor(best.obj.author);
  const date = typeof best.obj.datePublished === "string" ? best.obj.datePublished : "";
  const meta = [author && `By ${author}`, date].filter(Boolean).join(" · ");
  if (meta) parts.push(`*${meta}*`);

  parts.push(normalizeWhitespace(best.body));
  return parts.join("\n\n");
}

/* ----------------------------- Hydration -------------------------------- */

function extractNextData(html: string): string | null {
  const m = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[1].trim());
  } catch {
    return null;
  }
  return extractProseFromObject(data);
}

const STATE_MARKERS = [
  /window\.__NUXT__\s*=\s*/,
  /window\.__INITIAL_STATE__\s*=\s*/,
  /window\.__APOLLO_STATE__\s*=\s*/,
  /window\.__PRELOADED_STATE__\s*=\s*/,
  /window\.__remixContext\s*=\s*/,
  /window\.__data\s*=\s*/,
];

function extractHydrationState(html: string): string | null {
  for (const marker of STATE_MARKERS) {
    const m = marker.exec(html);
    if (!m) continue;
    const json = sliceBalancedJson(html, m.index + m[0].length);
    if (!json) continue;
    try {
      const prose = extractProseFromObject(JSON.parse(json));
      if (prose) return prose;
    } catch {
      // Not plain JSON (e.g. NUXT's function-wrapped form) — skip.
    }
  }
  return null;
}

/** From a position that should sit on `{` or `[`, return the balanced literal. */
function sliceBalancedJson(s: string, start: number): string | null {
  const open = s[start];
  if (open !== "{" && open !== "[") return null;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let escaped = false;
  const max = Math.min(s.length, start + 5_000_000);
  for (let i = start; i < max; i++) {
    const c = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function extractProseFromObject(root: unknown): string | null {
  const keyed: string[] = [];
  const loose: string[] = [];
  const seen = new WeakSet<object>();

  const walk = (node: unknown, key: string, depth: number): void => {
    if (depth > 14 || node === null || node === undefined) return;
    if (typeof node === "string") {
      if (node.length >= MIN_LENGTH) {
        if (CONTENT_KEY.test(key)) keyed.push(node);
        else if (looksLikeProse(node)) loose.push(node);
      }
      return;
    }
    if (typeof node !== "object") return;
    if (seen.has(node as object)) return;
    seen.add(node as object);
    if (Array.isArray(node)) {
      for (const v of node) walk(v, key, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, k, depth + 1);
  };
  walk(root, "", 0);

  const pool = keyed.length ? keyed : loose;
  if (pool.length === 0) return null;
  pool.sort((a, b) => b.length - a.length);

  const chosen = pool[0];
  const text = /<[a-z!/][\s\S]*>/i.test(chosen) ? stripHtml(chosen) : normalizeWhitespace(chosen);
  return text.length >= MIN_LENGTH ? text : null;
}

/** Heuristic: looks like human prose, not a URL, token, CSS, or serialized blob. */
function looksLikeProse(s: string): boolean {
  if (/\s/.test(s) === false) return false;
  const spaces = (s.match(/ /g) || []).length;
  if (spaces < 20) return false;
  if (!/[.!?。]/.test(s)) return false;
  const letters = (s.match(/[a-zA-ZÀ-ɏ]/g) || []).length;
  return letters / s.length > 0.5;
}

/* ------------------------------- Helpers -------------------------------- */

function normalizeWhitespace(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(html: string): string {
  let text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return normalizeWhitespace(decodeEntities(text));
}
