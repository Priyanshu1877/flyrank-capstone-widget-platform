import type { IGeoProvider, GeoLocation } from './geo.types.js';

export type MockProviderMode = 'success' | 'failure' | 'timeout';

export class MockGeoProviderA implements IGeoProvider {
  public readonly name = 'provider_a';
  private mode: MockProviderMode = 'success';
  private timeoutDelayMs = 800; // Simulated delay when in timeout mode (exceeds 500ms timeout)

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
      throw new Error('Provider A connection refused');
    }

    if (this.mode === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, this.timeoutDelayMs));
      throw new Error('Provider A timed out');
    }

    // Deterministic mock resolution based on simulated IP
    if (ip.startsWith('10.') || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
      return {
        country: 'US',
        city: 'San Francisco',
        provider: this.name,
      };
    }

    return {
      country: 'US',
      city: 'Austin',
      provider: this.name,
    };
  }
}

export const mockGeoProviderA = new MockGeoProviderA();
