import { describe, it, expect } from "vitest";
import { scoreContent } from "../quality.js";

describe("scoreContent", () => {
  it("returns 0 for content under 200 chars", () => {
    expect(scoreContent("Short content")).toBe(0);
  });

  it("returns 0 for CAPTCHA pages", () => {
    const captcha = "a".repeat(300) + " Please complete the captcha to continue ";
    expect(scoreContent(captcha)).toBe(0);
  });

  it("returns 0 for cf-challenge pages", () => {
    const cf = "a".repeat(300) + " cf-challenge-running ";
    expect(scoreContent(cf)).toBe(0);
  });

  it("returns 0 for recaptcha pages", () => {
    const rc = "a".repeat(300) + " g-recaptcha ";
    expect(scoreContent(rc)).toBe(0);
  });

  it("returns 0 for login walls", () => {
    const login = "a".repeat(300) + " Sign in to continue reading this article ";
    expect(scoreContent(login)).toBe(0);
  });

  it("returns 0 for subscribe walls", () => {
    const sub = "a".repeat(300) + " Subscribe to read the full article ";
    expect(scoreContent(sub)).toBe(0);
  });

  it("returns 0 for Cloudflare challenge", () => {
    const cf = "a".repeat(300) + " Checking your browser before accessing Ray ID: abc123 ";
    expect(scoreContent(cf)).toBe(0);
  });

  it("returns 0 for access denied pages", () => {
    const denied = "a".repeat(300) + " 403 Forbidden Access Denied ";
    expect(scoreContent(denied)).toBe(0);
  });

  it("returns high score for good content", () => {
    const good = "This is a well-written article about software engineering. ".repeat(20);
    expect(scoreContent(good)).toBeGreaterThan(0.7);
  });

  it("reduces score for high link-to-text ratio", () => {
    const linky = "[link](url) ".repeat(50) + "Some actual text content here. ".repeat(5);
    const normal = "Some actual text content here about real things. ".repeat(20);
    expect(scoreContent(linky)).toBeLessThan(scoreContent(normal));
  });

  it("returns moderate score for medium-length content", () => {
    const medium = "This is a decent article. ".repeat(10);
    const score = scoreContent(medium);
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(1);
  });
});
