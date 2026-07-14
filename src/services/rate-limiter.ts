export interface RateLimitConfig {
  enabled: boolean;
  requestsPerMinute: number;
}

export class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;
  private enabled: boolean;
  private queue: Promise<void> = Promise.resolve();

  constructor(config: RateLimitConfig) {
    this.enabled = config.enabled;
    this.maxRequests = config.requestsPerMinute;
    this.windowMs = 60000; // 1 minute
  }

  async checkLimit(): Promise<void> {
    if (!this.enabled) return;

    // Serialize reservations so concurrent requests cannot all observe the
    // same free slot and burst past the configured ceiling.
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      while (true) {
        const now = Date.now();
        this.requests = this.requests.filter(
          (time) => now - time < this.windowMs
        );

        if (this.requests.length < this.maxRequests) {
          this.requests.push(now);
          return;
        }

        const oldestRequest = Math.min(...this.requests);
        const waitTime = Math.max(
          1,
          this.windowMs - (now - oldestRequest) + 100
        );
        // stdout is reserved for the MCP JSON protocol.
        console.error(`Rate limit reached. Waiting ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    } finally {
      release();
    }
  }
}
