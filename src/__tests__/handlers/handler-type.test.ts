import { describe, it, expect } from "vitest";
import type { Handler, HandlerResult } from "../../types.js";

describe("Handler type", () => {
  it("defines the handler interface", () => {
    const handler: Handler = {
      name: "test",
      patterns: [/example\.com/],
      handle: async () => null,
    };
    expect(handler.name).toBe("test");
    expect(handler.patterns).toHaveLength(1);
  });

  it("defines HandlerResult with source field", () => {
    const result: HandlerResult = {
      content: "test content",
      source: "test-handler",
      timing: 100,
    };
    expect(result.source).toBe("test-handler");
  });
});
