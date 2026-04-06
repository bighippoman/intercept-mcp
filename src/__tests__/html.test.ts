import { describe, it, expect } from "vitest";
import { htmlToText, extractMeta, htmlToMarkdown } from "../html.js";

describe("htmlToText", () => {
  it("strips HTML tags", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("converts br to newlines", () => {
    expect(htmlToText("line1<br>line2<br/>line3")).toBe("line1\nline2\nline3");
  });

  it("converts block elements to double newlines", () => {
    expect(htmlToText("<p>Para 1</p><p>Para 2</p>")).toBe("Para 1\n\nPara 2");
  });

  it("strips script and style tags with content", () => {
    expect(htmlToText('<p>Hello</p><script>alert("x")</script><p>World</p>'))
      .toBe("Hello\n\nWorld");
  });

  it("decodes HTML entities", () => {
    expect(htmlToText("&amp; &lt; &gt; &quot; &#39;")).toBe('& < > " \'');
  });

  it("collapses whitespace", () => {
    expect(htmlToText("<p>  too   much   space  </p>")).toBe("too much space");
  });

  it("handles empty input", () => {
    expect(htmlToText("")).toBe("");
  });

  it("strips tags with attributes completely", () => {
    expect(htmlToText('<div id="__next" class="app"><p>Content</p></div>')).toBe("Content");
  });

  it("strips nav, header, footer, aside elements", () => {
    expect(htmlToText('<nav><a href="/">Home</a></nav><p>Article text</p><footer>Copyright</footer>'))
      .toBe("Article text");
  });

  it("extracts article content when available", () => {
    const html = '<nav>Menu</nav><article><p>Article content here</p></article><footer>Footer</footer>';
    expect(htmlToText(html)).toBe("Article content here");
  });

  it("extracts main content when available", () => {
    const html = '<header>Header</header><main><p>Main content</p></main><aside>Sidebar</aside>';
    expect(htmlToText(html)).toBe("Main content");
  });

  it("strips svg elements", () => {
    expect(htmlToText('<p>Text</p><svg viewBox="0 0 24 24"><path d="M0 0"/></svg><p>More</p>'))
      .toBe("Text\n\nMore");
  });
});

describe("extractMeta", () => {
  const html = `
    <html>
    <head>
      <title>Page Title</title>
      <meta property="og:title" content="OG Title" />
      <meta property="og:description" content="OG Description" />
      <meta property="og:image" content="https://example.com/img.jpg" />
      <meta property="article:author" content="Jane Doe" />
      <meta property="article:published_time" content="2025-01-15" />
      <meta name="description" content="Meta Description" />
    </head>
    <body><p>Body</p></body>
    </html>
  `;

  it("extracts og:title", () => {
    expect(extractMeta(html).ogTitle).toBe("OG Title");
  });

  it("extracts og:description", () => {
    expect(extractMeta(html).ogDescription).toBe("OG Description");
  });

  it("extracts og:image", () => {
    expect(extractMeta(html).ogImage).toBe("https://example.com/img.jpg");
  });

  it("extracts article:author", () => {
    expect(extractMeta(html).author).toBe("Jane Doe");
  });

  it("extracts article:published_time", () => {
    expect(extractMeta(html).publishedTime).toBe("2025-01-15");
  });

  it("extracts meta description", () => {
    expect(extractMeta(html).description).toBe("Meta Description");
  });

  it("extracts title tag", () => {
    expect(extractMeta(html).title).toBe("Page Title");
  });

  it("returns empty strings for missing meta", () => {
    const meta = extractMeta("<html><body>No meta</body></html>");
    expect(meta.ogTitle).toBe("");
    expect(meta.description).toBe("");
  });
});

describe("htmlToMarkdown", () => {
  it("converts headings to atx-style markdown", () => {
    const html = "<html><body><h1>Title</h1><h2>Subtitle</h2><p>Content that is long enough to pass the two hundred character minimum threshold for Readability extraction and quality scoring so we get a proper result back from the function.</p></body></html>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Title");
    expect(md).toContain("## Subtitle");
  });

  it("preserves links as markdown links", () => {
    const html = `<html><body><article><p>Visit <a href="https://example.com">Example</a> for more. ${"Content padding here. ".repeat(20)}</p></article></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("[Example](https://example.com)");
  });

  it("preserves bold and italic", () => {
    const html = `<html><body><article><p><strong>Bold text</strong> and <em>italic text</em>. ${"Padding content here. ".repeat(20)}</p></article></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("**Bold text**");
    expect(md).toMatch(/[*_]italic text[*_]/);
  });

  it("converts code blocks to fenced style", () => {
    const html = `<html><body><article><pre><code>const x = 1;</code></pre><p>${"Padding content. ".repeat(30)}</p></article></body></html>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("const x = 1;");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });

  it("falls back to regex+turndown when Readability fails", () => {
    const html = `<nav>Skip this</nav><main><p>Main content here ${"with enough padding. ".repeat(20)}</p></main><footer>Skip this too</footer>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain("Main content");
    expect(md).not.toContain("Skip this");
  });
});
