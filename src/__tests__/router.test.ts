import { describe, it, expect, vi } from "vitest";
import { routeUrl } from "../router.js";
import type { Handler, HandlerResult } from "../types.js";

function makeHandler(name: string, patterns: RegExp[], result: HandlerResult | null): Handler {
  return { name, patterns, handle: vi.fn().mockResolvedValue(result) };
}

describe("routeUrl", () => {
  it("returns null when no handler matches", async () => {
    const handlers = [makeHandler("twitter", [/twitter\.com\/\w+\/status\/\d+/], null)];
    const result = await routeUrl("https://example.com/article", handlers);
    expect(result).toBeNull();
    expect(handlers[0].handle).not.toHaveBeenCalled();
  });

  it("calls matching handler and returns result", async () => {
    const handlerResult: HandlerResult = { content: "tweet text", source: "twitter", timing: 50 };
    const handlers = [makeHandler("twitter", [/twitter\.com\/\w+\/status\/\d+/], handlerResult)];
    const result = await routeUrl("https://twitter.com/user/status/123", handlers);
    expect(result).not.toBeNull();
    expect(result!.content).toBe("tweet text");
    expect(handlers[0].handle).toHaveBeenCalledWith("https://twitter.com/user/status/123");
  });

  it("falls through to next handler if first returns null", async () => {
    const handlers = [
      makeHandler("twitter", [/twitter\.com/], null),
      makeHandler("fallback", [/twitter\.com/], { content: "fallback", source: "fallback", timing: 10 }),
    ];
    const result = await routeUrl("https://twitter.com/user/status/123", handlers);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("fallback");
  });

  it("matches against multiple patterns per handler", async () => {
    const handlerResult: HandlerResult = { content: "tweet", source: "twitter", timing: 50 };
    const handlers = [makeHandler("twitter", [/twitter\.com\/\w+\/status\/\d+/, /x\.com\/\w+\/status\/\d+/], handlerResult)];
    const result = await routeUrl("https://x.com/user/status/456", handlers);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("twitter");
  });

  it("catches handler errors and returns null", async () => {
    const handlers: Handler[] = [{
      name: "broken",
      patterns: [/example\.com/],
      handle: vi.fn().mockRejectedValue(new Error("crash")),
    }];
    const result = await routeUrl("https://example.com/test", handlers);
    expect(result).toBeNull();
  });
});
