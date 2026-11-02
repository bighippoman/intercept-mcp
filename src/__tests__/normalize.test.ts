import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../normalize.js";

describe("normalizeUrl", () => {
  it("strips utm tracking params", () => {
    expect(normalizeUrl("https://example.com/page?utm_source=twitter&utm_medium=social&id=123"))
      .toBe("https://example.com/page?id=123");
  });

  it("strips platform click IDs", () => {
    expect(normalizeUrl("https://example.com/page?fbclid=abc&gclid=def&msclkid=ghi&twclid=jkl"))
      .toBe("https://example.com/page");
  });

  it("strips email marketing params", () => {
    expect(normalizeUrl("https://example.com/page?mc_cid=abc&mc_eid=def&mkt_tok=ghi"))
      .toBe("https://example.com/page");
  });

  it("preserves access and gift parameters", () => {
    expect(normalizeUrl("https://example.com/article?embedded-checkout=1&paywall=open&gift=true"))
      .toBe("https://example.com/article?embedded-checkout=1&paywall=open&gift=true");
  });

  it("strips analytics while preserving potentially functional referral/session parameters", () => {
    expect(normalizeUrl("https://example.com/page?referer=twitter&_ga=123&sid=abc"))
      .toBe("https://example.com/page?referer=twitter&sid=abc");
  });

  it("preserves product variants and unrecognized parameters", () => {
    expect(normalizeUrl("https://example.com/page?variant=b&smid=xyz&sr_share=1"))
      .toBe("https://example.com/page?variant=b&smid=xyz&sr_share=1");
  });

  it("preserves pagination params", () => {
    expect(normalizeUrl("https://example.com/search?q=test&page=2&per_page=20"))
      .toBe("https://example.com/search?q=test&page=2&per_page=20");
  });

  it("strips hash fragments", () => {
    expect(normalizeUrl("https://example.com/page#section-2"))
      .toBe("https://example.com/page");
  });

  it("preserves explicit HTTP protocol", () => {
    expect(normalizeUrl("http://example.com/page"))
      .toBe("http://example.com/page");
  });

  it("adds https if no protocol", () => {
    expect(normalizeUrl("example.com/page"))
      .toBe("https://example.com/page");
  });

  it("preserves meaningful trailing slashes", () => {
    expect(normalizeUrl("https://example.com/page/"))
      .toBe("https://example.com/page/");
  });

  it("keeps root URL trailing slash", () => {
    expect(normalizeUrl("https://example.com/"))
      .toBe("https://example.com/");
  });

  it("preserves AMP query variants", () => {
    expect(normalizeUrl("https://example.com/article?amp=1"))
      .toBe("https://example.com/article?amp=1");
  });

  it("preserves AMP path variants", () => {
    expect(normalizeUrl("https://example.com/amp/article/123"))
      .toBe("https://example.com/amp/article/123");
  });

  it("handles URLs with no params gracefully", () => {
    expect(normalizeUrl("https://example.com/clean-url"))
      .toBe("https://example.com/clean-url");
  });

  it("handles already-clean URLs", () => {
    expect(normalizeUrl("https://example.com"))
      .toBe("https://example.com/");
  });
});
