import type { BrokerAssetSnapshot, BrokerAuthStatus } from "../types.js";

export type FetchBrokerAssetsOptions = {
  forceRefresh?: boolean;
  debug?: boolean;
  headless?: boolean;
};

export type ManualSessionSetupResult = {
  savedAt: string;
  storageStatePath: string;
  detectedUrl: string;
};

export interface BrokerAdapter {
  readonly id: string;
  readonly name: string;
  getAuthStatus(): Promise<BrokerAuthStatus>;
  setupManualSession(): Promise<ManualSessionSetupResult>;
  fetchAssetSnapshot(options?: FetchBrokerAssetsOptions): Promise<BrokerAssetSnapshot>;
}
