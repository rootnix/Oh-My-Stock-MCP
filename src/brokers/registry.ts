import type { AppConfig } from "../config.js";
import type { BrokerId } from "../types.js";
import { UserVisibleError } from "../lib/errors.js";
import type { BrokerAdapter } from "./base.js";
import { KorSecBroker } from "./korsec/adapter.js";
import { MiraeAssetBroker } from "./miraeasset/adapter.js";
import { NhSecBroker } from "./nhsec/adapter.js";
import { ShinhanSecBroker } from "./shinhansec/adapter.js";
import { SamsungPopBroker } from "./samsungpop/adapter.js";

export type BrokerRegistry = Record<BrokerId, BrokerAdapter>;

export function createBrokerRegistry(config: AppConfig): BrokerRegistry {
  return {
    samsungpop: new SamsungPopBroker(config),
    shinhansec: new ShinhanSecBroker(config),
    miraeasset: new MiraeAssetBroker(config),
    nhsec: new NhSecBroker(config),
    korsec: new KorSecBroker(config),
  };
}

export function getBrokerOrThrow(
  registry: BrokerRegistry,
  brokerId: BrokerId,
): BrokerAdapter {
  const broker = registry[brokerId];

  if (!broker) {
    throw new UserVisibleError(`지원하지 않는 brokerId 입니다: ${brokerId}`);
  }

  return broker;
}
