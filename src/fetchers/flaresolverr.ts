import { htmlToMarkdown } from "../html.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

/**
 * FlareSolverr fetcher — last-resort anti-bot bypass via a self-hosted
 * headless browser. The stealth fetcher mimics a browser's TLS fingerprint
 * but can't *execute* a Cloudflare / DDoS-Guard JS challenge; FlareSolverr
 * runs a real browser that solves the challenge and returns the page HTML.
 *
 * Opt-in: only active when FLARESOLVERR_URL points at a running FlareSolverr
 * instance (e.g. http://localhost:8191). Disabled by default.
 */

// Solving a challenge in a real browser can take a while.
const SOLVE_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 65_000;

function endpoint(): string | null {
  const raw = process.env.FLARESOLVERR_URL;
  if (!raw) return null;
  const base = raw.replace(/\/+$/, "");
  return /\/v1$/.test(base) ? base : `${base}/v1`;
}

interface FlareSolverrResponse {
  status: string;
  solution?: {
    status: number;
    response: string;
  };
}

export const flaresolverrFetcher: Fetcher = {
  name: "flaresolverr",
  tier: 3,
  async fetch(url: string): Promise<FetchResult | null> {
    const target = endpoint();
    if (!target) return null;

    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "request.get", url, maxTimeout: SOLVE_TIMEOUT_MS }),
        signal: controller.signal,
      });
      if (!response.ok) return null;

      const data = (await response.json()) as FlareSolverrResponse;
      if (data.status !== "ok" || !data.solution) return null;

      const { status, response: html } = data.solution;
      if (status < 200 || status >= 400 || !html || html.length < 200) return null;

      const content = htmlToMarkdown(html);
      return {
        content,
        source: "flaresolverr",
        quality: scoreContent(content),
        timing: Date.now() - start,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  },
};
