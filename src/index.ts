import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "intercept",
  version: "1.0.0",
});

server.registerTool(
  "fetch",
  {
    title: "Fetch URL",
    description:
      "Fetch a URL and return its content as clean markdown via Jina Reader.",
    inputSchema: {
      url: z.string().url().describe("The URL to fetch"),
    },
  },
  async ({ url }) => {
    const jinaUrl = `https://r.jina.ai/${url}`;

    const response = await fetch(jinaUrl, {
      headers: { Accept: "text/markdown" },
    });

    if (!response.ok) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`,
          },
        ],
        isError: true,
      };
    }

    const text = await response.text();
    return { content: [{ type: "text" as const, text }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
