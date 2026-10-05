import type { GeoLocation, IGeoProvider } from './geo.types.js';
import { mockGeoProviderA, type MockProviderMode } from './provider-a.js';
import { mockGeoProviderB } from './provider-b.js';

export class GeoService {
  private primaryProvider: IGeoProvider;
  private fallbackProvider: IGeoProvider;
  private timeoutMs: number;

  constructor(
    primary: IGeoProvider = mockGeoProviderA,
    fallback: IGeoProvider = mockGeoProviderB,
    timeoutMs = 500,
  ) {
    this.primaryProvider = primary;
    this.fallbackProvider = fallback;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Performs geo-enrichment with sequential failover:
   * 1. Try Provider A with timeout.
   * 2. If Provider A fails or times out, try Provider B with timeout.
   * 3. If Provider B fails or times out, return null (graceful nil-degradation).
   *
   * Guaranteed never to throw an unhandled error to the submission pipeline.
   */
  async lookup(ip: string): Promise<GeoLocation | null> {
    if (!ip) {
      return null;
    }

    // 1. Try Primary Provider (Provider A)
    try {
      const result = await this.executeWithTimeout(
        this.primaryProvider.lookup(ip),
        this.timeoutMs,
        this.primaryProvider.name,
      );

      if (result) {
        return result;
      }
    } catch (err) {
      console.warn(
        `[GeoService] Primary provider '${this.primaryProvider.name}' failed: ${(err as Error).message}. Attempting fallback...`,
      );
    }

    // 2. Try Fallback Provider (Provider B)
    try {
      const fallbackResult = await this.executeWithTimeout(
        this.fallbackProvider.lookup(ip),
        this.timeoutMs,
        this.fallbackProvider.name,
      );

      if (fallbackResult) {
        return fallbackResult;
      }
    } catch (fallbackErr) {
      console.warn(
        `[GeoService] Fallback provider '${this.fallbackProvider.name}' failed: ${(fallbackErr as Error).message}. Continuing with nil-degradation.`,
      );
    }

    // 3. Graceful Nil-Degradation: Both providers failed
    return null;
  }

  private executeWithTimeout<T>(promise: Promise<T>, ms: number, providerName: string): Promise<T> {
    let timer: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Geo provider '${providerName}' exceeded ${ms}ms timeout`));
      }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timer);
    });
  }

  // --- Testing & Lifecycle Helpers ---
  setProviderAMode(mode: MockProviderMode): void {
    mockGeoProviderA.setMode(mode);
  }

  setProviderBMode(mode: MockProviderMode): void {
    mockGeoProviderB.setMode(mode);
  }

  reset(): void {
    mockGeoProviderA.setMode('success');
    mockGeoProviderB.setMode('success');
    mockGeoProviderA.setTimeoutDelay(800);
    mockGeoProviderB.setTimeoutDelay(800);
  }

  setTimeoutMs(ms: number): void {
    this.timeoutMs = ms;
  }
}

export const geoService = new GeoService();
