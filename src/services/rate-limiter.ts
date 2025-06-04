export interface RateLimitConfig {
  enabled: boolean;
  requestsPerMinute: number;
}

export class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;
  private enabled: boolean;

  constructor(config: RateLimitConfig) {
    this.enabled = config.enabled;
    this.maxRequests = config.requestsPerMinute;
    this.windowMs = 60000; // 1 minute
  }

  async checkLimit(): Promise<void> {
    if (!this.enabled) return;

    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = Math.min(...this.requests);
      const waitTime = this.windowMs - (now - oldestRequest) + 100; // Add small buffer
      
      console.log(`Rate limit reached. Waiting ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requests.push(now);
  }
}