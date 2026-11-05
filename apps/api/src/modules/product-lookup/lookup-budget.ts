/** One deadline for all web work, including adapters that do not implement cancellation. */
export const WEB_ENRICHMENT_TIMEOUT_MS = 5_000;
export class LookupDeadlineError extends Error {
  constructor() { super('web enrichment deadline exceeded'); this.name = 'LookupDeadlineError'; }
}
export function abortableLookup<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  if (!signal) return work();
  if (signal.aborted) return Promise.reject(new LookupDeadlineError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new LookupDeadlineError());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw new LookupDeadlineError();
      return work();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
