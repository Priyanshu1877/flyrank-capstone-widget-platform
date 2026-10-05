import type { IGeoProvider, GeoLocation } from './geo.types.js';
import type { MockProviderMode } from './provider-a.js';

export class MockGeoProviderB implements IGeoProvider {
  public readonly name = 'provider_b';
  private mode: MockProviderMode = 'success';
  private timeoutDelayMs = 800;

  setMode(mode: MockProviderMode): void {
    this.mode = mode;
  }

  getMode(): MockProviderMode {
    return this.mode;
  }

  setTimeoutDelay(delayMs: number): void {
    this.timeoutDelayMs = delayMs;
  }

  async lookup(ip: string): Promise<GeoLocation | null> {
    if (this.mode === 'failure') {
      throw new Error('Provider B service unavailable');
    }

    if (this.mode === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, this.timeoutDelayMs));
      throw new Error('Provider B timed out');
    }

    // Provider B fallback location
    if (ip.startsWith('10.') || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
      return {
        country: 'CA',
        city: 'Toronto',
        provider: this.name,
      };
    }

    return {
      country: 'GB',
      city: 'London',
      provider: this.name,
    };
  }
}

export const mockGeoProviderB = new MockGeoProviderB();
