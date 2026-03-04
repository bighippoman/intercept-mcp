import type { Fetcher, FetchResult, PipelineResult, PipelineOptions, AttemptRecord } from "./types.js";

const DEFAULT_QUALITY_THRESHOLD = 0.3;

export async function runPipeline(
  url: string,
  fetchers: Fetcher[],
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const { maxTier = 5, qualityThreshold = DEFAULT_QUALITY_THRESHOLD } = options;
  const attempts: AttemptRecord[] = [];
  let lastResult: FetchResult | null = null;

  for (const fetcher of fetchers) {
    if (fetcher.tier > maxTier) {
      continue;
    }

    try {
      const result = await fetcher.fetch(url);

      if (!result) {
        attempts.push({ name: fetcher.name, status: "failed", reason: "returned null" });
        continue;
      }

      lastResult = result;

      if (result.quality >= qualityThreshold) {
        attempts.push({ name: fetcher.name, status: "success", quality: result.quality, timing: result.timing });
        return { result, attempts };
      }

      attempts.push({ name: fetcher.name, status: "failed", quality: result.quality, timing: result.timing, reason: `quality ${result.quality} < ${qualityThreshold}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      attempts.push({ name: fetcher.name, status: "failed", reason: message });
    }
  }

  if (lastResult) {
    return { result: lastResult, attempts };
  }

  return {
    result: { content: `Failed to fetch content from ${url}. All ${attempts.length} strategies failed.`, source: "none", quality: 0, timing: 0 },
    attempts,
  };
}

export function formatResult(pipelineResult: PipelineResult): string {
  const { result, attempts } = pipelineResult;

  const attemptsLog = attempts
    .map((a) => {
      if (a.status === "success") return `  - ${a.name}: success (${a.quality}, ${formatTiming(a.timing!)})`;
      if (a.status === "skipped") return `  - ${a.name}: skipped (${a.reason})`;
      return `  - ${a.name}: failed (${a.reason})`;
    })
    .join("\n");

  return `${result.content}\n\n---\nsource: ${result.source}\nquality: ${result.quality}\ntime: ${formatTiming(result.timing)}\nattempts:\n${attemptsLog}`;
}

function formatTiming(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
