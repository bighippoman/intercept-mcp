import { describe, it, expect } from "vitest";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

describe("Tool annotations", () => {
  it("fetch tool annotations are well-formed", () => {
    const annotations: ToolAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    };
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.idempotentHint).toBe(true);
    expect(annotations.openWorldHint).toBe(true);
  });

  it("search tool annotations are well-formed", () => {
    const annotations: ToolAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    };
    expect(annotations.readOnlyHint).toBe(true);
    expect(annotations.destructiveHint).toBe(false);
    expect(annotations.idempotentHint).toBe(false);
    expect(annotations.openWorldHint).toBe(true);
  });
});
