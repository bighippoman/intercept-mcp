import { AsyncLocalStorage } from "node:async_hooks";

const requests = new AsyncLocalStorage<{ signal: AbortSignal }>();

/** Carry MCP cancellation and an overall deadline through every fetcher. */
export function withRequestDeadline<T>(timeoutMs: number, signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const parent = requestSignal();
  const combined = AbortSignal.any([deadline, ...(signal ? [signal] : []), ...(parent ? [parent] : [])]);
  return requests.run({ signal: combined }, async () => {
    combined.throwIfAborted();
    let abort: (() => void) | undefined;
    try {
      return await Promise.race([run(), new Promise<never>((_, reject) => {
        abort = () => reject(combined.reason ?? new Error("Request deadline exceeded"));
        combined.addEventListener("abort", abort, { once: true });
        if (combined.aborted) abort();
      })]);
    } finally {
      if (abort) combined.removeEventListener("abort", abort);
    }
  });
}

export function requestSignal(): AbortSignal | undefined {
  return requests.getStore()?.signal;
}

export function throwIfCancelled(): void {
  requestSignal()?.throwIfAborted();
}
