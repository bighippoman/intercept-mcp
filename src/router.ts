import type { Handler, HandlerResult } from "./types.js";

export async function routeUrl(url: string, handlers: Handler[]): Promise<HandlerResult | null> {
  for (const handler of handlers) {
    const matches = handler.patterns.some((p) => p.test(url));
    if (!matches) continue;

    try {
      const result = await handler.handle(url);
      if (result) return result;
    } catch {
      continue;
    }
  }
  return null;
}
