import { getEnv, isMockMode } from "@/lib/config/env";
import { toCandidate } from "../normalizer";
import { ProviderHttpError, withRetry } from "../retry";
import type { CompanyDiscoveryProvider, DiscoveryCandidate, DiscoveryContext, DiscoveryQuery } from "../types";

/** 取得フィールドは営業探索に必要な最小限のみ（レビュー・画像等は取得しない） */
const FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.primaryType";

interface PlacesResponse {
  places?: {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    websiteUri?: string;
    primaryType?: string;
  }[];
}

/**
 * Google Places Provider。
 * 地域の中小企業・事業所・工場の発見と、公式サイト候補・電話・住所の補完に使う。
 */
export class GooglePlacesDiscoveryProvider implements CompanyDiscoveryProvider {
  readonly name = "google_places" as const;

  isAvailable(): boolean {
    return isMockMode() || Boolean(getEnv().GOOGLE_MAPS_API_KEY);
  }

  unavailableReason(): string | null {
    return this.isAvailable() ? null : "GOOGLE_MAPS_API_KEY が未設定です";
  }

  async search(query: DiscoveryQuery, context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    const textQuery = query.text?.trim();
    if (!textQuery) return [];
    const apiKey = getEnv().GOOGLE_MAPS_API_KEY;
    if (!apiKey) return [];

    const json = await withRetry(
      async () => {
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
          body: JSON.stringify({ textQuery, languageCode: "ja", regionCode: "JP", maxResultCount: Math.min(query.limit ?? 20, 20) }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new ProviderHttpError(`Google Places エラー: ${text.slice(0, 200)}`, res.status);
        }
        return (await res.json()) as PlacesResponse;
      },
      { maxAttempts: 3, onRetry: (a, d) => void context.log("warn", `Google Places を再試行します (${a}回目, ${d}ms待機)`) },
    );

    return (json.places ?? [])
      .filter((p) => p.displayName?.text)
      .map((p) =>
        toCandidate({
          name: p.displayName!.text!,
          address: p.formattedAddress ?? null,
          phone: p.nationalPhoneNumber ?? null,
          website: p.websiteUri ?? null,
          industry: query.criteria.industry ?? null,
          source: "google_places",
          sourceId: p.id ?? null,
          sourceUrl: p.id ? `https://www.google.com/maps/place/?q=place_id:${p.id}` : null,
          // 事業所として実在する裏付けはあるが、法人格や登記情報の裏付けはない
          sourceConfidence: 65,
          rawData: p,
        }),
      );
  }
}
