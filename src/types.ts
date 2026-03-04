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

export interface HandlerResult {
  content: string;
  source: string;
  timing: number;
}

export interface Handler {
  name: string;
  patterns: RegExp[];
  handle: (url: string) => Promise<HandlerResult | null>;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  results: SearchResult[];
  source: string;
  timing: number;
}
