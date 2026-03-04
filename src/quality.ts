const CAPTCHA_PATTERNS = [
  /captcha/i,
  /cf-challenge/i,
  /g-recaptcha/i,
  /recaptcha/i,
  /hcaptcha/i,
];

const LOGIN_WALL_PATTERNS = [
  /sign in to continue/i,
  /log in to continue/i,
  /create an account/i,
  /subscribe to read/i,
  /subscribe to continue/i,
  /sign up to read/i,
  /register to continue/i,
];

const BLOCK_PATTERNS = [
  /checking your browser/i,
  /ray id:/i,
  /403 forbidden/i,
  /access denied/i,
  /401 unauthorized/i,
];

export function scoreContent(content: string): number {
  if (content.length < 200) return 0;

  // Only check structural patterns in the first 500 chars to avoid false positives
  // on articles that discuss auth, CAPTCHAs, or HTTP errors
  const head = content.slice(0, 500);

  for (const pattern of CAPTCHA_PATTERNS) {
    if (pattern.test(head)) return 0;
  }
  for (const pattern of LOGIN_WALL_PATTERNS) {
    if (pattern.test(head)) return 0;
  }
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(head)) return 0;
  }

  let score = 1.0;

  const linkCount = (content.match(/\[.*?\]\(.*?\)/g) || []).length;
  const wordCount = content.split(/\s+/).length;
  if (wordCount > 0) {
    const linkRatio = linkCount / wordCount;
    if (linkRatio > 0.1) {
      score -= Math.min(0.5, linkRatio * 2);
    }
  }

  const lengthBonus = Math.min(0.3, content.length / 5000);
  score = Math.min(1.0, score * 0.7 + lengthBonus + 0.1);

  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}
