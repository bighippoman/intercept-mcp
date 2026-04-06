import { describe, it, expect, vi, beforeEach } from "vitest";
import { wikipediaHandler } from "../../handlers/wikipedia.js";

describe("wikipediaHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct name and patterns", () => {
    expect(wikipediaHandler.name).toBe("wikipedia");
    expect(wikipediaHandler.patterns[0].test("https://en.wikipedia.org/wiki/TypeScript")).toBe(true);
    expect(wikipediaHandler.patterns[0].test("https://fr.wikipedia.org/wiki/JavaScript")).toBe(true);
  });

  it("does not match non-wiki URLs", () => {
    expect(wikipediaHandler.patterns[0].test("https://example.com")).toBe(false);
    expect(wikipediaHandler.patterns[0].test("https://en.wikipedia.org/")).toBe(false);
  });

  it("returns null for non-wikipedia URL", async () => {
    const result = await wikipediaHandler.handle("https://example.com");
    expect(result).toBeNull();
  });

  it("extracts content from HTML endpoint", async () => {
    const html = `<html><body><section><p>TypeScript is a programming language developed by Microsoft. ${"Content padding here. ".repeat(20)}</p></section></body></html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 })
    );

    const result = await wikipediaHandler.handle("https://en.wikipedia.org/wiki/TypeScript");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("TypeScript");
    expect(result!.source).toBe("wikipedia");
  });

  it("falls back to summary endpoint when HTML is too short", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("<html><body>Short</body></html>", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        title: "TypeScript",
        description: "Programming language",
        extract: "TypeScript is a free and open-source programming language developed by Microsoft.",
      }), { status: 200 }));

    const result = await wikipediaHandler.handle("https://en.wikipedia.org/wiki/TypeScript");
    expect(result).not.toBeNull();
    expect(result!.content).toContain("TypeScript");
    expect(result!.content).toContain("Programming language");
  });

  it("returns null when both endpoints fail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 })
    );
    const result = await wikipediaHandler.handle("https://en.wikipedia.org/wiki/Nonexistent_Page_XYZ");
    expect(result).toBeNull();
  });
});
