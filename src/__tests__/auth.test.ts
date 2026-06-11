import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { authHeadersFor, hasAuthFor, __resetAuthForTests } from "../auth.js";

const originalEnv = { ...process.env };

describe("auth", () => {
  beforeEach(() => {
    __resetAuthForTests();
    delete process.env.INTERCEPT_AUTH;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    __resetAuthForTests();
  });

  it("returns no headers when unconfigured", () => {
    expect(authHeadersFor("https://nytimes.com/x")).toEqual({});
    expect(hasAuthFor("https://nytimes.com/x")).toBe(false);
  });

  it("attaches configured headers for the exact host", () => {
    process.env.INTERCEPT_AUTH = JSON.stringify({ "nytimes.com": { Cookie: "nyt-s=abc" } });
    expect(authHeadersFor("https://nytimes.com/2026/article")).toEqual({ Cookie: "nyt-s=abc" });
    expect(hasAuthFor("https://nytimes.com/2026/article")).toBe(true);
  });

  it("matches subdomains of a configured domain", () => {
    process.env.INTERCEPT_AUTH = JSON.stringify({ "example.com": { Authorization: "Bearer t" } });
    expect(authHeadersFor("https://api.example.com/v1")).toEqual({ Authorization: "Bearer t" });
    expect(authHeadersFor("https://www.example.com/")).toEqual({ Authorization: "Bearer t" });
  });

  it("does NOT match unrelated hosts (no credential leak)", () => {
    process.env.INTERCEPT_AUTH = JSON.stringify({ "example.com": { Cookie: "secret=1" } });
    // suffix look-alikes and intermediaries must not match
    expect(authHeadersFor("https://notexample.com/")).toEqual({});
    expect(authHeadersFor("https://evil-example.com/")).toEqual({});
    expect(authHeadersFor("https://r.jina.ai/https://example.com/")).toEqual({});
    expect(authHeadersFor("https://web.archive.org/web/2026/https://example.com/")).toEqual({});
  });

  it("accepts a URL form for the domain key", () => {
    process.env.INTERCEPT_AUTH = JSON.stringify({ "https://acme.com/login": { "X-Token": "k" } });
    expect(authHeadersFor("https://acme.com/dashboard")).toEqual({ "X-Token": "k" });
  });

  it("strips a wildcard prefix on the domain key", () => {
    process.env.INTERCEPT_AUTH = JSON.stringify({ "*.acme.com": { "X-Token": "k" } });
    expect(authHeadersFor("https://app.acme.com/")).toEqual({ "X-Token": "k" });
  });

  it("drops forbidden hop-by-hop headers", () => {
    process.env.INTERCEPT_AUTH = JSON.stringify({ "acme.com": { Host: "evil.com", Cookie: "ok=1" } });
    expect(authHeadersFor("https://acme.com/")).toEqual({ Cookie: "ok=1" });
  });

  it("ignores malformed INTERCEPT_AUTH instead of throwing", () => {
    process.env.INTERCEPT_AUTH = "{ not json";
    expect(authHeadersFor("https://acme.com/")).toEqual({});
    expect(hasAuthFor("https://acme.com/")).toBe(false);
  });

  it("merges headers across multiple matching entries", () => {
    process.env.INTERCEPT_AUTH = JSON.stringify({
      "acme.com": { Cookie: "a=1" },
      "api.acme.com": { Authorization: "Bearer t" },
    });
    expect(authHeadersFor("https://api.acme.com/")).toEqual({ Cookie: "a=1", Authorization: "Bearer t" });
  });
});
