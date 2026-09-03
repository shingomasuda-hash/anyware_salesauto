import { getEnv, isMockMode } from "@/lib/config/env";

export interface PlaceCandidate {
  name: string;
  address: string | null;
  phone: string | null;
  websiteUrl: string | null;
  placeId: string | null;
}

export interface PlacesProvider {
  readonly name: "google_places" | "mock" | "disabled";
  /** 企業名 + 住所で検索し、公式サイト候補（website）を返す */
  findCompany(query: string): Promise<PlaceCandidate[]>;
}

/**
 * Google Places API (New) Text Search。
 * 公式サイト候補の発見にのみ利用する（企業マスタの主データ源ではない）。
 */
class GooglePlacesClient implements PlacesProvider {
  readonly name = "google_places" as const;
  constructor(private readonly apiKey: string) {}

  async findCompany(query: string): Promise<PlaceCandidate[]> {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri",
      },
      body: JSON.stringify({ textQuery: query, languageCode: "ja", regionCode: "JP", maxResultCount: 3 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Google Places API エラー: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      places?: { id?: string; displayName?: { text?: string }; formattedAddress?: string; nationalPhoneNumber?: string; websiteUri?: string }[];
    };
    return (json.places ?? []).map((p) => ({
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? null,
      phone: p.nationalPhoneNumber ?? null,
      websiteUrl: p.websiteUri ?? null,
      placeId: p.id ?? null,
    }));
  }
}

class MockPlacesProvider implements PlacesProvider {
  readonly name = "mock" as const;
  async findCompany(query: string): Promise<PlaceCandidate[]> {
    // モックでは名前から slug を作って example.jp の候補を返す
    const slug = query
      .toLowerCase()
      .replace(/株式会社|有限会社|合同会社/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!slug) return [];
    return [{ name: query, address: null, phone: null, websiteUrl: `https://mock-${slug}.example.jp`, placeId: `mock-${slug}` }];
  }
}

class DisabledPlacesProvider implements PlacesProvider {
  readonly name = "disabled" as const;
  async findCompany(): Promise<PlaceCandidate[]> {
    return [];
  }
}

export function getPlacesProvider(): PlacesProvider {
  if (isMockMode()) return new MockPlacesProvider();
  const key = getEnv().GOOGLE_MAPS_API_KEY;
  return key ? new GooglePlacesClient(key) : new DisabledPlacesProvider();
}
