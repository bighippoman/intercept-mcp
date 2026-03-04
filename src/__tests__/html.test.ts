import { describe, it, expect } from "vitest";
import { htmlToText, extractMeta } from "../html.js";

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
