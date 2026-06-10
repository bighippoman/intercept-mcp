import { describe, it, expect } from "vitest";
import { extractEmbeddedContent } from "../embedded-json.js";
import { htmlToMarkdown } from "../html.js";

const LONG = "This is a sentence of real article prose with enough words to clear the length floor. ".repeat(6);

describe("extractEmbeddedContent — JSON-LD", () => {
  it("extracts articleBody from a NewsArticle", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: "Breaking: Something Happened",
      author: { "@type": "Person", name: "Jane Reporter" },
      datePublished: "2026-01-01",
      articleBody: LONG,
    })}</script></head><body><div id="app"></div></body></html>`;

    const out = extractEmbeddedContent(html);
    expect(out).not.toBeNull();
    expect(out).toContain("# Breaking: Something Happened");
    expect(out).toContain("By Jane Reporter");
    expect(out).toContain("real article prose");
  });

  it("finds an Article nested in an @graph", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "wrapper" },
        { "@type": "Article", headline: "Graph Article", articleBody: LONG },
      ],
    })}</script>`;

    const out = extractEmbeddedContent(html);
    expect(out).toContain("# Graph Article");
    expect(out).toContain("real article prose");
  });

  it("prefers a typed Article over an untyped object with a body", () => {
    const html = `
      <script type="application/ld+json">${JSON.stringify({ "@type": "Thing", articleBody: "untyped " + LONG })}</script>
      <script type="application/ld+json">${JSON.stringify({ "@type": "Article", headline: "Real", articleBody: "typed " + LONG })}</script>`;
    const out = extractEmbeddedContent(html);
    expect(out).toContain("# Real");
    expect(out).toContain("typed");
  });

  it("ignores malformed JSON-LD blocks", () => {
    const html = `<script type="application/ld+json">{ not valid json }</script>`;
    expect(extractEmbeddedContent(html)).toBeNull();
  });

  it("ignores JSON-LD with only a short body", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ "@type": "Article", articleBody: "too short" })}</script>`;
    expect(extractEmbeddedContent(html)).toBeNull();
  });
});

describe("extractEmbeddedContent — hydration state", () => {
  it("extracts prose from __NEXT_DATA__", () => {
    const next = { props: { pageProps: { post: { title: "T", body: LONG } } } };
    const html = `<div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>`;
    const out = extractEmbeddedContent(html);
    expect(out).not.toBeNull();
    expect(out).toContain("real article prose");
  });

  it("extracts and strips HTML-valued content fields", () => {
    const next = { props: { pageProps: { article: { contentHtml: `<p>${LONG}</p><p>Second paragraph here.</p>` } } } };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>`;
    const out = extractEmbeddedContent(html);
    expect(out).not.toBeNull();
    expect(out).not.toContain("<p>");
    expect(out).toContain("real article prose");
  });

  it("extracts from window.__INITIAL_STATE__ assignment", () => {
    const state = { entities: { articles: { "1": { body: LONG } } } };
    const html = `<script>window.__INITIAL_STATE__ = ${JSON.stringify(state)};</script>`;
    const out = extractEmbeddedContent(html);
    expect(out).toContain("real article prose");
  });

  it("skips function-wrapped __NUXT__ that is not plain JSON", () => {
    const html = `<script>window.__NUXT__=(function(a,b){return {data:a}}(1,2));</script>`;
    expect(extractEmbeddedContent(html)).toBeNull();
  });

  it("does not surface short or non-prose strings", () => {
    const next = { props: { config: { apiUrl: "https://api.example.com/v1/very/long/path/that/is/not/prose/at/all/x" } } };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>`;
    expect(extractEmbeddedContent(html)).toBeNull();
  });
});

describe("extractEmbeddedContent — negatives", () => {
  it("returns null when there is no script", () => {
    expect(extractEmbeddedContent("<html><body><p>plain</p></body></html>")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractEmbeddedContent("")).toBeNull();
  });
});

describe("htmlToMarkdown integration", () => {
  it("recovers SPA-shell content from embedded JSON", () => {
    const next = { props: { pageProps: { post: { body: LONG } } } };
    const html = `<html><body><div id="__next"></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("real article prose");
  });

  it("prefers full JSON-LD body over a paywall teaser in the DOM", () => {
    const teaser = "Subscribers only. Here is a short teaser paragraph that the page actually renders for visitors.";
    const html = `<html><body><article><p>${teaser}</p></article>
      <script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", headline: "Full Story", articleBody: LONG })}</script>
      </body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("real article prose");
    expect(md.length).toBeGreaterThan(teaser.length * 2);
  });

  it("leaves normal articles (no embedded JSON) to the DOM extractor", () => {
    const html = `<html><body><article><h1>Normal</h1><p>${LONG}</p></article></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("Normal");
    expect(md).toContain("real article prose");
  });
});
