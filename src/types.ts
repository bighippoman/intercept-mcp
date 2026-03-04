export interface FetchResult {
  content: string;
  source: string;
  quality: number;
  timing: number;
}

export interface Fetcher {
  name: string;
  tier: number;
  fetch: (url: string) => Promise<FetchResult | null>;
}

export interface PipelineResult {
  result: FetchResult;
  attempts: AttemptRecord[];
}

export interface AttemptRecord {
  name: string;
  status: "success" | "failed" | "skipped";
  quality?: number;
  timing?: number;
  reason?: string;
}

export interface PipelineOptions {
  maxTier?: number;
  qualityThreshold?: number;
}
