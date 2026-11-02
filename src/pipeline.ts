import type { Fetcher, FetchResult, PipelineResult, PipelineOptions, AttemptRecord } from "./types.js";
import { detectBlock, buildDiagnosis, type BlockReason } from "./classify.js";

import { throwIfCancelled, withRequestDeadline } from "./request-context.js";

const DEFAULT_QUALITY_THRESHOLD = 0.3;
const PARALLEL_TIER = 2;

export async function runPipeline(
  url: string,
  fetchers: Fetcher[],
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  const { maxTier = 5, qualityThreshold = DEFAULT_QUALITY_THRESHOLD, allowArchive = true, health } = options;
  // Tiers must run in ascending order, and the parallel-tier grouping below
  // only batches *consecutive* entries — a stable sort guarantees both
  // regardless of how callers ordered the array.
  const orderedFetchers = fetchers.filter((f) => allowArchive || !/^(wayback|arquivo|archive-ph|common-crawl)$/.test(f.name)).sort((a, b) => a.tier - b.tier);
  const invoke = async (f: Fetcher): Promise<FetchResult | null> => {
    throwIfCancelled();
    const healthKey = /^(raw|markdown-endpoint|stealth)$/.test(f.name) ? `${f.name}:${new URL(url).host}` : f.name;
    if (health && !health.available(healthKey)) return null;
    try {
      const result = await f.fetch(url);
      throwIfCancelled();
      health?.record(healthKey, !!result && result.quality >= qualityThreshold);
      return result;
    } catch (error) {
      throwIfCancelled();
      health?.record(healthKey, false);
      throw error;
    }
  };
  const attempts: AttemptRecord[] = [];
  let bestFallback: FetchResult | null = null;
  const blockReasons = new Set<BlockReason>();

  let i = 0;
  while (i < orderedFetchers.length) {
    throwIfCancelled();
    const fetcher = orderedFetchers[i];

    if (fetcher.tier > maxTier) {
      i++;
      continue;
    }

    // Collect all fetchers at the parallel tier and run them concurrently
    if (fetcher.tier === PARALLEL_TIER) {
      const tierFetchers: Fetcher[] = [];
      while (i < orderedFetchers.length && orderedFetchers[i].tier === PARALLEL_TIER) {
        if (orderedFetchers[i].tier <= maxTier) tierFetchers.push(orderedFetchers[i]);
        i++;
      }

      // Allow a short quality-comparison window, then stop waiting for a slow
      // hosted provider once another has returned usable content.
      const group = new AbortController();
      const results = await new Promise<PromiseSettledResult<FetchResult | null>[]>((resolve) => {
        const settled: PromiseSettledResult<FetchResult | null>[] = tierFetchers.map(() => ({status:"rejected",reason:new Error("cancelled after another provider succeeded")}));
        let pending=tierFetchers.length, done=false;
        let grace: ReturnType<typeof setTimeout> | undefined;
        const finish=()=>{if(done)return;done=true;if(grace)clearTimeout(grace);resolve([...settled]);group.abort();};
        tierFetchers.forEach((f,index)=>{
          withRequestDeadline(25_000,group.signal,()=>invoke(f)).then(value=>{
            settled[index]={status:"fulfilled",value};
            if(value && value.quality>=qualityThreshold && !grace)grace=setTimeout(finish,200);
          },reason=>{settled[index]={status:"rejected",reason};}).finally(()=>{if(--pending===0)finish();});
        });
      });

      let bestResult: FetchResult | null = null;
      let bestFetcher: Fetcher | null = null;

      for (let j = 0; j < results.length; j++) {
        const settled = results[j];
        const f = tierFetchers[j];

        if (settled.status === "rejected") {
          attempts.push({ name: f.name, status: "failed", reason: settled.reason?.message ?? "unknown error" });
          continue;
        }

        const result = settled.value;
        if (!result) {
          attempts.push({ name: f.name, status: "failed", reason: "returned null" });
          continue;
        }

        if (result.quality < qualityThreshold) {
          const reason = detectBlock(result.content);
          attempts.push({ name: f.name, status: "failed", quality: result.quality, timing: result.timing, reason: reason ? `blocked: ${reason}` : `quality ${result.quality} < ${qualityThreshold}` });
          // A detected block is misleading, not "best effort" — never let it win.
          if (reason) blockReasons.add(reason);
          else if (!bestFallback || result.quality > bestFallback.quality) bestFallback = result;
          continue;
        }

        if (!bestResult || result.quality > bestResult.quality) {
          bestResult = result;
          bestFetcher = f;
        }
      }

      throwIfCancelled();
      if (bestResult && bestFetcher) {
        for (let j = 0; j < results.length; j++) {
          const f = tierFetchers[j];
          const settled = results[j];
          if (f === bestFetcher) {
            attempts.push({ name: f.name, status: "success", quality: bestResult.quality, timing: bestResult.timing });
          } else if (settled.status === "fulfilled" && settled.value && settled.value.quality >= qualityThreshold) {
            attempts.push({ name: f.name, status: "skipped", quality: settled.value.quality, timing: settled.value.timing, reason: "not best result" });
          }
        }
        return { result: bestResult, attempts };
      }

      continue;
    }

    // Sequential execution for all other tiers
    try {
      const result = await invoke(fetcher);

      if (!result) {
        attempts.push({ name: fetcher.name, status: "failed", reason: "returned null" });
        i++;
        continue;
      }

      if (result.quality >= qualityThreshold) {
        attempts.push({ name: fetcher.name, status: "success", quality: result.quality, timing: result.timing });
        return { result, attempts };
      }

      const reason = detectBlock(result.content);
      if (reason) blockReasons.add(reason);
      else if (!bestFallback || result.quality > bestFallback.quality) bestFallback = result;
      attempts.push({ name: fetcher.name, status: "failed", quality: result.quality, timing: result.timing, reason: reason ? `blocked: ${reason}` : `quality ${result.quality} < ${qualityThreshold}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      attempts.push({ name: fetcher.name, status: "failed", reason: message });
    }

    i++;
  }

  throwIfCancelled();
  const diagnosis = buildDiagnosis(blockReasons);

  if (bestFallback && bestFallback.quality >= 0.1) {
    return { result: { ...bestFallback, completeness: "partial" }, attempts, diagnosis };
  }

  return {
    result: { content: `Failed to fetch content from ${url}. All ${attempts.length} strategies failed.`, source: "none", quality: 0, timing: 0 },
    attempts,
    diagnosis,
  };
}

export function formatResult(pipelineResult: PipelineResult): string {
  const { result, attempts, diagnosis } = pipelineResult;

  const tried = attempts
    .map((a) => {
      if (a.status === "success") return `${a.name} ✓`;
      return a.name;
    })
    .join(" → ");

  let out = `${result.content}\n\n---\nsource: ${result.source} | ${formatTiming(result.timing)} | ${tried}`;
  if (result.completeness) out += `\ncontent: ${result.completeness} | kind: ${result.sourceKind ?? "live"}${result.retrievedAt ? ` | retrieved: ${result.retrievedAt}` : ""}`;
  if (diagnosis) out += `\n\n⚠️ ${diagnosis}`;
  return out;
}

function formatTiming(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
