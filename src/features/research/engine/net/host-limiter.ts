export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Politeness per host: one request at a time, and a pause between the end of one request and
 * the start of the next (at least `minIntervalMs`, or the site's Crawl-delay, capped at
 * `maxIntervalMs`). Different hosts proceed independently.
 */
export class HostRateLimiter {
  readonly #minIntervalMs: number;
  readonly #maxIntervalMs: number;
  readonly #clock: Clock;
  readonly #hosts = new Map<string, { tail: Promise<void>; nextAt: number; pending: number }>();

  constructor(options: { minIntervalMs?: number; maxIntervalMs?: number; clock?: Clock } = {}) {
    this.#minIntervalMs = options.minIntervalMs ?? 2_000;
    this.#maxIntervalMs = options.maxIntervalMs ?? 10_000;
    this.#clock = options.clock ?? systemClock;
  }

  intervalFor(crawlDelayMs = 0) {
    return Math.min(Math.max(this.#minIntervalMs, crawlDelayMs), this.#maxIntervalMs);
  }

  async run<T>(host: string, task: () => Promise<T>, crawlDelayMs = 0): Promise<T> {
    const key = host.toLowerCase();
    let state = this.#hosts.get(key);
    if (!state) {
      state = { tail: Promise.resolve(), nextAt: 0, pending: 0 };
      this.#hosts.set(key, state);
    }
    const slot = state;
    const previous = slot.tail;
    let release = () => {};
    slot.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    slot.pending += 1;

    await previous;
    try {
      const wait = slot.nextAt - this.#clock.now();
      if (wait > 0) await this.#clock.sleep(wait);
      return await task();
    } finally {
      slot.nextAt = this.#clock.now() + this.intervalFor(crawlDelayMs);
      slot.pending -= 1;
      release();
      // Forget idle hosts once their pause has passed, so the map does not grow forever.
      if (slot.pending === 0) {
        const nextAt = slot.nextAt;
        setTimeout(() => {
          const current = this.#hosts.get(key);
          if (current && current.pending === 0 && current.nextAt === nextAt)
            this.#hosts.delete(key);
        }, this.#maxIntervalMs + 1_000).unref();
      }
    }
  }
}
