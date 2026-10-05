export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
  total: number;
}

/**
 * In-memory sliding window rate limiter.
 * Tracks request timestamps per client IP.
 * Guarantees that changing widgetId does not bypass IP-level protection.
 */
export class SlidingWindowRateLimiter {
  private hits: Map<string, number[]> = new Map();
  private windowMs: number;
  private maxRequests: number;

  constructor(options: RateLimiterOptions = { windowMs: 60_000, maxRequests: 60 }) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  /**
   * Consumes one request token for the given client IP.
   */
  consume(ip: string, now: number = Date.now()): RateLimitCheckResult {
    const windowStart = now - this.windowMs;
    let timestamps = this.hits.get(ip) || [];

    // Filter out timestamps older than the sliding window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      // Oldest timestamp in current window determines retry-after
      const oldest = timestamps[0];
      const retryAfterMs = Math.max(0, oldest + this.windowMs - now);
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

      this.hits.set(ip, timestamps);
      return {
        allowed: false,
        retryAfterSeconds,
        remaining: 0,
        total: timestamps.length,
      };
    }

    // Record this request
    timestamps.push(now);
    this.hits.set(ip, timestamps);

    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, this.maxRequests - timestamps.length),
      total: timestamps.length,
    };
  }

  /**
   * Configures rate limit options (useful for tests and environment tuning).
   */
  configure(options: Partial<RateLimiterOptions>): void {
    if (options.windowMs !== undefined) this.windowMs = options.windowMs;
    if (options.maxRequests !== undefined) this.maxRequests = options.maxRequests;
  }

  /**
   * Resets all tracking state (used in testing).
   */
  reset(): void {
    this.hits.clear();
  }

  /**
   * Returns current configuration.
   */
  getConfig(): RateLimiterOptions {
    return {
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
    };
  }
}

export const submissionRateLimiter = new SlidingWindowRateLimiter({
  windowMs: 60_000, // 1 minute window
  maxRequests: 60, // 60 requests per minute per IP
});
