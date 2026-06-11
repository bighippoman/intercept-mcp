import { describe, it, expect } from "vitest";
import { detectBlock, buildDiagnosis } from "../classify.js";

const pad = (s: string) => "Some leading text. " + s + " and trailing content.";

describe("detectBlock", () => {
  it("detects Cloudflare managed challenges", () => {
    expect(detectBlock(pad("Just a moment... Enable JavaScript and cookies to continue"))).toBe("challenge");
    expect(detectBlock(pad("Checking your browser before accessing. Ray ID: 8a1b"))).toBe("challenge");
    expect(detectBlock(pad("Verifying you are human. This may take a few seconds."))).toBe("challenge");
  });

  it("detects DataDome / DDoS-Guard / Imperva interstitials", () => {
    expect(detectBlock(pad("Pardon our interruption while we verify your request"))).toBe("challenge");
    expect(detectBlock(pad("DDoS protection by Cloudflare"))).toBe("challenge");
    expect(detectBlock(pad("powered by DataDome"))).toBe("challenge");
  });

  it("detects CAPTCHA pages", () => {
    expect(detectBlock(pad("Please complete the captcha"))).toBe("challenge");
    expect(detectBlock(pad("g-recaptcha challenge"))).toBe("challenge");
  });

  it("detects JS-shell announcements", () => {
    expect(detectBlock(pad("You need to enable JavaScript to run this app."))).toBe("needs-js");
    expect(detectBlock(pad("This page requires JavaScript to function."))).toBe("needs-js");
  });

  it("detects paywalls and login walls", () => {
    expect(detectBlock(pad("Sign in to continue reading"))).toBe("paywall");
    expect(detectBlock(pad("Subscribe to read the full article"))).toBe("paywall");
    expect(detectBlock(pad("This article is for subscribers"))).toBe("paywall");
  });

  it("detects rate limiting", () => {
    expect(detectBlock(pad("429 Too Many Requests"))).toBe("rate-limited");
    expect(detectBlock(pad("You are being rate limited"))).toBe("rate-limited");
  });

  it("prioritizes challenge over other reasons", () => {
    expect(detectBlock(pad("Just a moment... Sign in to continue"))).toBe("challenge");
  });

  it("returns null for genuine content", () => {
    expect(detectBlock("This is a normal article about web scraping techniques and tools. ".repeat(10))).toBeNull();
  });

  it("only scans the head, ignoring matches deep in long articles", () => {
    const article = "Real article content here. ".repeat(40) + " The history of the CAPTCHA is interesting.";
    expect(detectBlock(article)).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(detectBlock("")).toBeNull();
  });
});

describe("buildDiagnosis", () => {
  it("returns undefined for no reasons", () => {
    expect(buildDiagnosis([])).toBeUndefined();
  });

  it("explains a challenge with the FlareSolverr remedy", () => {
    const d = buildDiagnosis(["challenge"])!;
    expect(d).toContain("anti-bot challenge");
    expect(d).toContain("FLARESOLVERR_URL");
  });

  it("explains a JS shell with the Cloudflare render remedy", () => {
    const d = buildDiagnosis(["needs-js"])!;
    expect(d).toContain("CF_API_TOKEN");
  });

  it("combines multiple reasons in a stable order", () => {
    const d = buildDiagnosis(["paywall", "challenge"])!;
    expect(d.indexOf("anti-bot")).toBeLessThan(d.indexOf("paywall"));
  });
});
