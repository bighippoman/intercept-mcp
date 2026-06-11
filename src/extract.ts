import { parseHTML } from "linkedom";

/**
 * Structured extraction: pull specific values out of a page's DOM rather than
 * dumping the whole thing as markdown. CSS-selector field extraction plus
 * automatic HTML-table-to-JSON. This is the "scrape these fields" counterpart
 * to the fetch tool's "read this page".
 */

export interface SelectorSpec {
  selector: string;
  /** Extract this attribute (e.g. "href", "src") instead of the text content. */
  attr?: string;
  /** Return every match as an array instead of just the first. */
  all?: boolean;
}

export type SelectorMap = Record<string, string | SelectorSpec>;

export type FieldValue = string | string[] | null;

export interface ExtractResult {
  fields?: Record<string, FieldValue>;
  tables?: Array<Array<Record<string, string>>>;
}

interface MinimalElement {
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<MinimalElement> & Iterable<MinimalElement>;
}

function normalizeSpec(spec: string | SelectorSpec): SelectorSpec {
  return typeof spec === "string" ? { selector: spec } : spec;
}

function clean(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function valueOf(el: MinimalElement, attr?: string): string {
  return attr ? clean(el.getAttribute(attr)) : clean(el.textContent);
}

function extractTables(document: MinimalElement): Array<Array<Record<string, string>>> {
  const out: Array<Array<Record<string, string>>> = [];

  for (const table of Array.from(document.querySelectorAll("table"))) {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) continue;

    // Header row: explicit <th>, else fall back to the first row's cells.
    let headerCells = Array.from(rows[0].querySelectorAll("th"));
    let bodyStart = 1;
    if (headerCells.length === 0) {
      headerCells = Array.from(rows[0].querySelectorAll("td"));
    }
    const headers = headerCells.map((c, i) => clean(c.textContent) || `col${i}`);

    const data: Array<Record<string, string>> = [];
    for (let r = bodyStart; r < rows.length; r++) {
      const cells = Array.from(rows[r].querySelectorAll("td, th"));
      if (cells.length === 0) continue;
      const obj: Record<string, string> = {};
      cells.forEach((c, i) => {
        obj[headers[i] ?? `col${i}`] = clean(c.textContent);
      });
      data.push(obj);
    }
    if (data.length > 0) out.push(data);
  }

  return out;
}

export function extractFromHtml(html: string, selectors?: SelectorMap, tables?: boolean): ExtractResult {
  const { document } = parseHTML(html);
  const root = document as unknown as MinimalElement;
  const result: ExtractResult = {};

  if (selectors && Object.keys(selectors).length > 0) {
    result.fields = {};
    for (const [name, raw] of Object.entries(selectors)) {
      const spec = normalizeSpec(raw);
      try {
        const matches = Array.from(root.querySelectorAll(spec.selector));
        if (spec.all) {
          result.fields[name] = matches.map((el) => valueOf(el, spec.attr)).filter((v) => v.length > 0);
        } else {
          result.fields[name] = matches.length > 0 ? valueOf(matches[0], spec.attr) : null;
        }
      } catch {
        // Invalid/unsupported selector — surface as empty rather than crashing.
        result.fields[name] = spec.all ? [] : null;
      }
    }
  }

  if (tables) {
    result.tables = extractTables(root);
  }

  return result;
}
