/** Per-server circuit breaker. A failed provider is retried after a short cooldown. */
export class ProviderHealth {
  private entries = new Map<string, { failures: number; retryAt: number; successes: number }>();
  available(name: string): boolean {
    return (this.entries.get(name)?.retryAt ?? 0) <= Date.now();
  }
  record(name: string, success: boolean): void {
    const previous = this.entries.get(name) ?? { failures: 0, retryAt: 0, successes: 0 };
    const failures = success ? 0 : previous.failures + 1;
    this.entries.set(name, { failures, retryAt: failures >= 3 ? Date.now() + 30_000 : 0, successes: previous.successes + Number(success) });
  }
  snapshot() {
    return [...this.entries].map(([provider, value]) => ({ provider, ...value }));
  }
}
