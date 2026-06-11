/**
 * Per-domain authentication: attach user-supplied headers/cookies to requests
 * for a specific origin, so the fetch tools can read content the user is
 * legitimately logged in to (subscriptions, dashboards, intranets, private APIs).
 *
 * Configured via INTERCEPT_AUTH, a JSON object mapping a domain to a header map:
 *
 *   INTERCEPT_AUTH='{"nytimes.com":{"Cookie":"nyt-s=...; nyt-a=..."},
 *                    "api.acme.com":{"Authorization":"Bearer ..."}}'
 *
 * A domain entry also matches its subdomains (example.com -> www./api.example.com).
 *
 * SECURITY: headers are keyed on the *actual host being contacted*. They are
 * therefore only ever sent to the configured origin — never to Jina, web
 * archives, CORS proxies, FlareSolverr, or the shared cache, even when those
 * intermediaries are used to fetch the same logical URL. Callers must also
 * keep authed responses out of the shared cache (see hasAuthFor).
 */

// Hop-by-hop / connection headers a user should never be able to inject.
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
]);

interface DomainAuth {
  domain: string;
  headers: Record<string, string>;
}

let parsed: DomainAuth[] | null = null;

function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (!d) return null;
  if (d.includes("://")) {
    try {
      d = new URL(d).hostname;
    } catch {
      return null;
    }
  }
  d = d.replace(/^\*\./, "").replace(/^\.+/, "").replace(/\.+$/, "");
  return d || null;
}

function sanitizeHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = key.trim();
    if (!name || FORBIDDEN_HEADERS.has(name.toLowerCase())) continue;
    if (typeof value === "string" && value.length > 0) out[name] = value;
  }
  return out;
}

function load(): DomainAuth[] {
  if (parsed) return parsed;
  parsed = [];
  const raw = process.env.INTERCEPT_AUTH;
  if (!raw) return parsed;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    for (const [domain, headers] of Object.entries(obj)) {
      const norm = normalizeDomain(domain);
      const clean = sanitizeHeaders(headers);
      if (norm && Object.keys(clean).length > 0) parsed.push({ domain: norm, headers: clean });
    }
  } catch {
    // Malformed INTERCEPT_AUTH — ignore rather than crash the server.
  }
  return parsed;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith("." + domain);
}

/** Headers to attach when contacting `url`, based on its host. Empty if none. */
export function authHeadersFor(url: string): Record<string, string> {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const { domain, headers } of load()) {
    if (hostMatches(host, domain)) Object.assign(out, headers);
  }
  return out;
}

/**
 * Whether `url`'s origin has configured credentials. Callers use this to keep
 * authenticated responses out of the shared cache (don't publish private
 * content; don't serve a public anonymous copy in place of the authed view).
 */
export function hasAuthFor(url: string): boolean {
  return Object.keys(authHeadersFor(url)).length > 0;
}

/** Reset parsed config between tests. */
export function __resetAuthForTests(): void {
  parsed = null;
}
