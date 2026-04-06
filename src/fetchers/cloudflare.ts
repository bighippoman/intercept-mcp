import { fetchWithTimeout } from "../fetch-with-timeout.js";
import { scoreContent } from "../quality.js";
import type { Fetcher, FetchResult } from "../types.js";

export const cloudflareFetcher: Fetcher = {
  name: "cloudflare",
  tier: 1,
  async fetch(url: string): Promise<FetchResult | null> {
    const accountId = process.env.CF_ACCOUNT_ID;
    const apiToken = process.env.CF_API_TOKEN;
    if (!accountId || !apiToken) return null;

    const start = Date.now();
    try {
      const response = await fetchWithTimeout(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/markdown`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url,
            gotoOptions: { waitUntil: "networkidle0" },
            rejectResourceTypes: ["image", "font", "media", "stylesheet"],
          }),
        },
        15_000
      );

      if (!response.ok) return null;

      const data = (await response.json()) as { success: boolean; result?: string };
      if (!data.success || !data.result) return null;

      return {
        content: data.result,
        source: "cloudflare",
        quality: scoreContent(data.result),
        timing: Date.now() - start,
      };
    } catch {
      return null;
    }
  },
};
