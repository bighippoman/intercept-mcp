import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../normalize.js";

describe("normalizeUrl", () => {
  it("strips utm tracking params", () => {
    expect(normalizeUrl("https://example.com/page?utm_source=twitter&utm_medium=social&id=123"))
      .toBe("https://example.com/page?id=123");
  });

  it("strips fbclid and gclid", () => {
    expect(normalizeUrl("https://example.com/page?fbclid=abc123&gclid=def456"))
      .toBe("https://example.com/page");
  });

  it("strips mc_cid and mc_eid", () => {
    expect(normalizeUrl("https://example.com/page?mc_cid=abc&mc_eid=def"))
      .toBe("https://example.com/page");
  });

  it("strips hash fragments", () => {
    expect(normalizeUrl("https://example.com/page#section-2"))
      .toBe("https://example.com/page");
  });

  it("ensures https prefix", () => {
    expect(normalizeUrl("http://example.com/page"))
      .toBe("https://example.com/page");
  });

  it("adds https if no protocol", () => {
    expect(normalizeUrl("example.com/page"))
      .toBe("https://example.com/page");
  });

  it("removes trailing slash", () => {
    expect(normalizeUrl("https://example.com/page/"))
      .toBe("https://example.com/page");
  });

  it("keeps root URL trailing slash", () => {
    expect(normalizeUrl("https://example.com/"))
      .toBe("https://example.com/");
  });

  it("strips AMP param", () => {
    expect(normalizeUrl("https://example.com/article?amp=1"))
      .toBe("https://example.com/article");
  });

  it("strips AMP path segment", () => {
    expect(normalizeUrl("https://example.com/amp/article/123"))
      .toBe("https://example.com/article/123");
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
