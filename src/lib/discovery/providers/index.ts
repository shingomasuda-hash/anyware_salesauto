import { isMockMode } from "@/lib/config/env";
import { getDiscoveryConfig } from "@/lib/config/discovery";
import { GbizDiscoveryProvider } from "./gbiz";
import { GooglePlacesDiscoveryProvider } from "./google-places";
import { WebSearchDiscoveryProvider } from "./web-search";
import { EdinetDiscoveryProvider } from "./edinet";
import { OfficialWebProvider } from "./official-web";
import { MockEdinetProvider, MockGbizProvider, MockPlacesProvider, MockWebSearchProvider } from "./mock";
import type { CompanyDiscoveryProvider, DiscoveryMode, DiscoveryProviderName } from "../types";

/** 探索に使う Provider（official_web は確認専用なので含めない） */
export function allSearchProviders(): CompanyDiscoveryProvider[] {
  if (isMockMode()) {
    return [new MockGbizProvider(), new MockPlacesProvider(), new MockWebSearchProvider(), new MockEdinetProvider()];
  }
  return [new GbizDiscoveryProvider(), new GooglePlacesDiscoveryProvider(), new WebSearchDiscoveryProvider(), new EdinetDiscoveryProvider()];
}

export function getOfficialWebProvider(): OfficialWebProvider {
  return new OfficialWebProvider();
}

/** DISCOVERY_MODE で使う Provider を制限する */
const MODE_PROVIDERS: Record<DiscoveryMode, DiscoveryProviderName[]> = {
  gbiz: ["gbiz"],
  places: ["google_places"],
  search: ["web_search"],
  hybrid: ["gbiz", "google_places", "web_search", "edinet"],
};

export interface ProviderAvailability {
  name: DiscoveryProviderName;
  available: boolean;
  reason: string | null;
}

/** 各 Provider の利用可否（preflight / UI 表示用） */
export function getProviderAvailability(): ProviderAvailability[] {
  return [...allSearchProviders(), getOfficialWebProvider()].map((p) => ({
    name: p.name,
    available: p.isAvailable(),
    reason: p.unavailableReason(),
  }));
}

/**
 * 実際に使う Provider を決定する。
 * 未設定の Provider があっても Discovery 全体を失敗させず、使えるものだけで続行する。
 */
export function resolveProviders(mode?: DiscoveryMode): { providers: CompanyDiscoveryProvider[]; skipped: { name: DiscoveryProviderName; reason: string }[] } {
  const effectiveMode = mode ?? getDiscoveryConfig().mode;
  const allowed = MODE_PROVIDERS[effectiveMode] ?? MODE_PROVIDERS.hybrid;
  const providers: CompanyDiscoveryProvider[] = [];
  const skipped: { name: DiscoveryProviderName; reason: string }[] = [];

  for (const p of allSearchProviders()) {
    if (!allowed.includes(p.name)) continue;
    if (p.isAvailable()) providers.push(p);
    else skipped.push({ name: p.name, reason: p.unavailableReason() ?? "利用できません" });
  }
  return { providers, skipped };
}

export { GbizDiscoveryProvider, GooglePlacesDiscoveryProvider, WebSearchDiscoveryProvider, EdinetDiscoveryProvider, OfficialWebProvider };
