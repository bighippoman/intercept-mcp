export interface FetchResult {
  content: string;
  source: string;
  quality: number;
  timing: number;
  /** Age of the content when served from a cache, in seconds. */
  ageSeconds?: number;
  completeness?: "complete" | "partial" | "unavailable";
  sourceKind?: "live" | "archive" | "metadata" | "image";
  retrievedAt?: string;
  verifiedAt?: string;
  canonicalUrl?: string;
  contentHash?: string;
  archivedAt?: string;
  title?: string;
}

export interface Fetcher {
  name: string;
  tier: number;
  fetch: (url: string) => Promise<FetchResult | null>;
}

export interface PipelineResult {
  result: FetchResult;
  attempts: AttemptRecord[];
  /** Actionable explanation when the page was blocked (challenge, paywall, etc.). */
  diagnosis?: string;
}

export interface AttemptRecord {
  name: string;
  status: "success" | "failed" | "skipped";
  quality?: number;
  timing?: number;
  reason?: string;
}

export interface PipelineOptions {
  health?: import("./provider-health.js").ProviderHealth;
  maxTier?: number;
  qualityThreshold?: number;
  allowArchive?: boolean;
}

export interface HandlerResult {
  content: string;
  source: string;
  timing: number;
  completeness?: "complete" | "partial" | "unavailable";
  sourceKind?: "live" | "archive" | "metadata" | "image";
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

export interface SearchOptions {
  /** Restrict freshness of results. Supported by Brave and SearXNG; ignored by DuckDuckGo. */
  freshness?: "day" | "week" | "month" | "year";
  /** 1-based results page. Supported by Brave and SearXNG; ignored by DuckDuckGo. */
  page?: number;
}
