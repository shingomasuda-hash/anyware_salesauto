import { getSubcategories } from "./taxonomy";
import type { DiscoveryCriteria } from "./types";

export interface QueryShard {
  city?: string;
  subcategory?: string;
  label: string;
}

/**
 * 大量取得時に「都道府県 × 市区町村 × 業種細分」へ分割する。
 * Provider の 1 クエリあたり取得件数には上限があるため、
 * 少数のクエリで大量に取ろうとせず、条件を分割して網羅性を上げる。
 */
export function buildShards(criteria: DiscoveryCriteria, cities: string[], maxShards = 12): QueryShard[] {
  const subs = getSubcategories(criteria.industry);
  const subKeys = criteria.industrySubcategory
    ? subs.filter((s) => s.key === criteria.industrySubcategory)
    : subs;

  // 市区町村が指定済みならその 1 つだけ、未指定なら候補都市で分割
  const cityList = criteria.city ? [criteria.city] : cities;

  const shards: QueryShard[] = [];
  if (cityList.length === 0 && subKeys.length === 0) {
    return [{ label: criteria.prefecture ?? "全国" }];
  }
  if (cityList.length === 0) {
    for (const s of subKeys) shards.push({ subcategory: s.key, label: s.label });
    return shards.slice(0, maxShards);
  }
  if (subKeys.length === 0) {
    for (const c of cityList) shards.push({ city: c, label: c });
    return shards.slice(0, maxShards);
  }

  // 市区町村と業種細分の組み合わせ。件数が増えすぎないよう交互に取る
  for (const c of cityList) {
    for (const s of subKeys) {
      shards.push({ city: c, subcategory: s.key, label: `${c} × ${s.label}` });
      if (shards.length >= maxShards) return shards;
    }
  }
  return shards;
}

/** 主要都市（市区町村が未指定のときの分割候補）。網羅性より代表性を優先する */
export const MAJOR_CITIES: Record<string, string[]> = {
  大阪府: ["大阪市", "東大阪市", "堺市", "八尾市", "吹田市", "枚方市", "豊中市", "岸和田市"],
  東京都: ["大田区", "足立区", "板橋区", "江戸川区", "墨田区", "港区", "新宿区", "八王子市"],
  愛知県: ["名古屋市", "豊田市", "岡崎市", "一宮市", "刈谷市", "安城市"],
  神奈川県: ["横浜市", "川崎市", "相模原市", "厚木市", "藤沢市"],
  兵庫県: ["神戸市", "尼崎市", "姫路市", "西宮市", "加古川市"],
  埼玉県: ["さいたま市", "川口市", "川越市", "所沢市", "草加市"],
  京都府: ["京都市", "宇治市", "長岡京市"],
  福岡県: ["福岡市", "北九州市", "久留米市"],
  静岡県: ["浜松市", "静岡市", "富士市", "沼津市"],
  広島県: ["広島市", "福山市", "呉市"],
};

export function citiesFor(prefecture: string | undefined): string[] {
  if (!prefecture) return [];
  return MAJOR_CITIES[prefecture] ?? [];
}
