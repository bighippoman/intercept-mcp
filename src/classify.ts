/**
 * Classify a fetched page as a soft block — an HTTP 200 whose body is really
 * an anti-bot challenge, a JS shell, a paywall, or a rate-limit notice rather
 * than the content. These slip past status-code checks and, left undetected,
 * get returned to the agent (or cached) as if they were the real page.
 *
 * Detection drives two things: the quality score (blocks score 0) and an
 * actionable diagnosis in the pipeline's failure output, so the agent learns
 * *why* a fetch failed and which knob would fix it.
 *
 * Patterns are matched only against the head of the content to avoid false
 * positives on articles that happen to discuss CAPTCHAs, paywalls, etc.
 */

export type BlockReason = "challenge" | "needs-js" | "paywall" | "rate-limited";

const HEAD_CHARS = 500;

// Anti-bot interstitials and CAPTCHAs (Cloudflare, DDoS-Guard, DataDome,
// PerimeterX/HUMAN, Akamai, Imperva/Distil, generic reCAPTCHA/hCaptcha).
const CHALLENGE: RegExp[] = [
  /captcha/i,
  /cf-challenge/i,
  /g-recaptcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /px-captcha/i,
  /datadome/i,
  /checking your browser/i,
  /checking if the site connection is secure/i,
  /just a moment/i,
  /verify(?:ing)? you are (?:a )?human/i,
  /are you a robot/i,
  /enable javascript and cookies to continue/i,
  /attention required.{0,40}cloudflare/i,
  /ddos protection by/i,
  /pardon our interruption/i,
  /you have been blocked/i,
  /access to this page has been denied/i,
  /please (?:wait|stand by) while we (?:verify|check)/i,
  /ray id:/i,
  /403 forbidden/i,
  /access denied/i,
  /401 unauthorized/i,
];

// Client-side-rendered shells that announce they need JavaScript.
const NEEDS_JS: RegExp[] = [
  /you need to enable javascript to run this app/i,
  /please enable javascript to (?:view|continue|use|run)/i,
  /this (?:page|site|application|app) requires javascript/i,
];

const PAYWALL: RegExp[] = [
  /sign in to continue/i,
  /log in to continue/i,
  /create an account/i,
  /subscribe to read/i,
  /subscribe to continue/i,
  /sign up to read/i,
  /register to continue/i,
  /this (?:article|content|story) is (?:for|available to) subscribers/i,
  /already a subscriber/i,
  /to continue reading/i,
];

const RATE_LIMITED: RegExp[] = [
  /too many requests/i,
  /you are being rate limited/i,
  /429 too many requests/i,
];

export function detectBlock(content: string): BlockReason | null {
  if (!content) return null;
  const head = content.slice(0, HEAD_CHARS);
  if (CHALLENGE.some((r) => r.test(head))) return "challenge";
  if (NEEDS_JS.some((r) => r.test(head))) return "needs-js";
  if (PAYWALL.some((r) => r.test(head))) return "paywall";
  if (RATE_LIMITED.some((r) => r.test(head))) return "rate-limited";
  return null;
}

const REMEDY: Record<BlockReason, string> = {
  challenge:
    "an anti-bot challenge (e.g. Cloudflare/DDoS-Guard) — set FLARESOLVERR_URL to solve it in a real browser, or route through a residential HTTPS_PROXY",
  "needs-js":
    "client-side JavaScript rendering (an SPA shell) — set CF_API_TOKEN + CF_ACCOUNT_ID to enable browser rendering",
  paywall: "a paywall or login wall",
  "rate-limited": "rate limiting by the origin — retry later or set HTTPS_PROXY",
};

/** A human-readable, actionable explanation of why a fetch was blocked. */
export function buildDiagnosis(reasons: Iterable<BlockReason>): string | undefined {
  const set = new Set(reasons);
  if (set.size === 0) return undefined;
  // Stable, most-actionable-first ordering.
  const order: BlockReason[] = ["challenge", "needs-js", "paywall", "rate-limited"];
  const parts = order.filter((r) => set.has(r)).map((r) => REMEDY[r]);
  return `The page appears to be protected by ${parts.join("; and ")}.`;
}
