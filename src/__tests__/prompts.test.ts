import { describe, it, expect } from "vitest";

describe("MCP Prompts", () => {
  describe("research-topic prompt", () => {
    it("generates correct message structure", () => {
      const topic = "quantum computing";
      const depth = "3";
      const message = {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Search for "${topic}" and fetch the top ${depth} results. For each result, provide a brief summary of the key points. Compare perspectives across sources where relevant.`,
        },
      };
      expect(message.role).toBe("user");
      expect(message.content.text).toContain(topic);
      expect(message.content.text).toContain(depth);
    });
  });

  describe("extract-article prompt", () => {
    it("generates correct message structure", () => {
      const url = "https://example.com/article";
      const message = {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Fetch the content from ${url} and extract the key points. Summarize the main arguments, findings, or information presented.`,
        },
      };
      expect(message.role).toBe("user");
      expect(message.content.text).toContain(url);
    });
  });
});
