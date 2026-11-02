/** Coalesce concurrent equivalent reads without sharing one caller's cancellation. */
export class SingleFlight<T> {
  private running = new Map<string, { promise: Promise<T>; controller: AbortController; users: number }>();
  async run(key: string, signal: AbortSignal | undefined, start: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    let entry = this.running.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, users: 0, promise: Promise.resolve().then(() => start(controller.signal)) };
      this.running.set(key, entry);
      const current = entry;
      void entry.promise.finally(() => { if (this.running.get(key) === current) this.running.delete(key); }).catch(() => {});
    }
    entry.users++;
    let abort: (() => void) | undefined;
    try {
      if (!signal) return await entry.promise;
      return await Promise.race([entry.promise, new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason ?? new Error("Request cancelled"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      })]);
    } finally {
      if (abort) signal?.removeEventListener("abort", abort);
      entry.users--;
      if (entry.users === 0) {
        entry.controller.abort();
        if (this.running.get(key) === entry) this.running.delete(key);
      }
    }
  }
}
