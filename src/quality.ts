import { detectBlock } from "./classify.js";

export function scoreContent(content: string): number {
  if (content.length < 200) return 0;

  // Anti-bot challenges, JS shells, paywalls, and rate-limit pages are not
  // usable content even with a 200 status — score them 0 so the pipeline
  // never returns or caches them.
  if (detectBlock(content)) return 0;

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
