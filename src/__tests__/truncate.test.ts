import { describe, it, expect } from "vitest";
import { sliceContent, sliceWithNotice, DEFAULT_MAX_LENGTH } from "../truncate.js";

describe("sliceContent", () => {
  it("returns content unchanged when under the limit", () => {
    const slice = sliceContent("short content", 100);
    expect(slice.text).toBe("short content");
    expect(slice.truncated).toBe(false);
    expect(slice.nextStartIndex).toBeUndefined();
    expect(slice.totalLength).toBe(13);
    expect(slice.returnedLength).toBe(13);
  });

  it("truncates content over the limit and reports nextStartIndex", () => {
    const content = "a".repeat(150);
    const slice = sliceContent(content, 100);
    expect(slice.text).toHaveLength(100);
    expect(slice.truncated).toBe(true);
    expect(slice.nextStartIndex).toBe(100);
    expect(slice.totalLength).toBe(150);
  });

  it("paginates from startIndex", () => {
    const content = "0123456789";
    const slice = sliceContent(content, 4, 4);
    expect(slice.text).toBe("4567");
    expect(slice.truncated).toBe(true);
    expect(slice.nextStartIndex).toBe(8);
  });

  it("final page is not marked truncated", () => {
    const content = "0123456789";
    const slice = sliceContent(content, 4, 8);
    expect(slice.text).toBe("89");
    expect(slice.truncated).toBe(false);
    expect(slice.nextStartIndex).toBeUndefined();
  });

  it("startIndex past the end returns an explanatory message", () => {
    const slice = sliceContent("short", 100, 500);
    expect(slice.text).toContain("past the end");
    expect(slice.returnedLength).toBe(0);
    expect(slice.truncated).toBe(false);
  });

  it("exports a sane default max length", () => {
    expect(DEFAULT_MAX_LENGTH).toBeGreaterThanOrEqual(10_000);
  });
});

describe("sliceWithNotice", () => {
  it("appends a continuation instruction when truncated", () => {
    const content = "x".repeat(200);
    const slice = sliceWithNotice(content, 100);
    expect(slice.text).toContain("Content truncated");
    expect(slice.text).toContain("startIndex=100");
  });

  it("adds no notice when content fits", () => {
    const slice = sliceWithNotice("fits fine", 100);
    expect(slice.text).toBe("fits fine");
  });
});
