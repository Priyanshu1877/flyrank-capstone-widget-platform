export interface GeoLocation {
  country: string;
  city: string;
  provider: string;
}

export interface IGeoProvider {
  readonly name: string;
  lookup(ip: string): Promise<GeoLocation | null>;
}
