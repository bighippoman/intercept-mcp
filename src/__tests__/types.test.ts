import { describe, it, expect } from "vitest";
import type { FetchResult, Fetcher, PipelineResult, AttemptRecord, PipelineOptions } from "../types.js";

describe("types", () => {
  it("FetchResult satisfies the interface", () => {
    const result: FetchResult = {
      content: "hello",
      source: "test",
      quality: 0.9,
      timing: 100,
    };
    expect(result.content).toBe("hello");
  });

  it("AttemptRecord can represent success", () => {
    const attempt: AttemptRecord = {
      name: "jina",
      status: "success",
      quality: 0.85,
      timing: 1200,
    };
    expect(attempt.status).toBe("success");
  });

  it("AttemptRecord can represent failure", () => {
    const attempt: AttemptRecord = {
      name: "archive-ph",
      status: "failed",
      reason: "HTTP 404",
    };
    expect(attempt.reason).toBe("HTTP 404");
  });
});
