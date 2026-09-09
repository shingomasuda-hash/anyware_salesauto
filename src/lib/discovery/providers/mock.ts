import { INDUSTRIES } from "@/lib/companies/constants";
import { toCandidate } from "../normalizer";
import type { CompanyDiscoveryProvider, DiscoveryCandidate, DiscoveryQuery, DiscoveryProviderName, MergedCandidate } from "../types";

/**
 * DATA_MODE=mock 用の Provider 群。
 * 3 つの情報源が一部重なる企業集合を返し、Multi-Source Discovery の
 * 重複排除・情報統合・本人確認の挙動を実APIなしで確認できるようにする。
 *
 * 企業プールは共通で、Provider ごとに「見える範囲」と「持っている情報」が異なる:
 *   - GビズINFO : index 0-49（法人番号・所在地あり、URL は一部のみ）
 *   - Places    : index 30-69（住所・電話・URL あり、法人番号なし）
 *   - Web Search: index 55-84（URL のみ、法人番号・住所なし）
 * → 0-29 は Gビズのみ、30-49 は Gビズ+Places、55-69 は Places+Search で重複する。
 */
const WORDS = ["sakura", "hikari", "daiwa", "kansai", "naniwa", "yamato", "asahi", "shinsei", "kyowa", "meiwa", "taiyo", "fuji", "tokai", "nishi", "higashi", "minami", "kita", "chuo", "heiwa", "eiwa", "kokusai", "sanwa", "nichiei", "toyo", "seiko", "koyo", "nissin", "marui", "wako", "kyoei"];
const SUFFIX = ["seisakusho", "kogyo", "tech", "kikai", "seiki", "kinzoku", "denki", "works"];
const CITIES = ["大阪市中央区", "東大阪市", "八尾市", "堺市堺区", "吹田市", "大阪市西区"];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface MockCompany {
  index: number;
  slug: string;
  displayName: string;
  corporateNumber: string;
  address: string;
  phone: string;
  website: string;
  hasWebsite: boolean;
}

function mockCompany(index: number, prefecture: string): MockCompany {
  const w = WORDS[index % WORDS.length];
  const s = SUFFIX[Math.floor(index / WORDS.length) % SUFFIX.length];
  const slug = `${w}-${s}-${index}`;
  const h = hash(slug);
  return {
    index,
    slug,
    displayName: `${w.charAt(0).toUpperCase()}${w.slice(1)} ${s.charAt(0).toUpperCase()}${s.slice(1)} ${index}株式会社`,
    corporateNumber: String(1000000000000 + (h % 8999999999999)),
    address: `${prefecture}${CITIES[h % CITIES.length]}本町${1 + (h % 4)}丁目${1 + ((h >> 3) % 20)}-${1 + ((h >> 7) % 30)}`,
    phone: `06-${String(1000 + (h % 9000))}-${String((h >> 8) % 10000).padStart(4, "0")}`,
    website: `https://mock-${slug}.example.jp`,
    hasWebsite: h % 9 !== 0,
  };
}

/** Provider ごとに担当するインデックス範囲（重複が生まれるよう意図的に重ねる） */
const RANGES: Record<string, [number, number]> = {
  gbiz: [0, 50],
  google_places: [30, 70],
  web_search: [55, 85],
};

function buildRange(provider: DiscoveryProviderName, query: DiscoveryQuery, limit: number): MockCompany[] {
  const [start, end] = RANGES[provider] ?? [0, 30];
  const prefecture = query.criteria.prefecture ?? "大阪府";
  // シャードごとに開始位置をずらし、クエリを増やすほど新しい企業が出るようにする
  const offset = query.shard?.city ? hash(query.shard.city) % 10 : 0;
  const page = (query.page ?? 1) - 1;
  const from = start + offset + page * limit;
  const out: MockCompany[] = [];
  for (let i = from; i < Math.min(from + limit, end); i++) out.push(mockCompany(i, prefecture));
  return out;
}

export class MockGbizProvider implements CompanyDiscoveryProvider {
  readonly name = "gbiz" as const;
  isAvailable() {
    return true;
  }
  unavailableReason() {
    return null;
  }
  async search(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    const industry = query.criteria.industry ?? INDUSTRIES[0].key;
    await new Promise((r) => setTimeout(r, 10));
    return buildRange("gbiz", query, query.limit ?? 20).map((c) =>
      toCandidate({
        name: c.displayName,
        address: c.address,
        corporateNumber: c.corporateNumber,
        // GビズINFO は URL を持たない法人が多い、という実態を再現する
        website: c.index % 3 === 0 && c.hasWebsite ? c.website : null,
        industry,
        source: "gbiz",
        sourceId: c.corporateNumber,
        sourceUrl: `https://info.gbiz.go.jp/hojin/ichiran?hojinBangou=${c.corporateNumber}`,
        sourceConfidence: 90,
        rawData: { mock: true, index: c.index },
      }),
    );
  }
  async enrich(candidate: MergedCandidate): Promise<DiscoveryCandidate | null> {
    if (candidate.corporateNumber) return null;
    // モックでは名前が一致する企業を総当りで探し、法人番号を補完する
    for (let i = 0; i < 90; i++) {
      const c = mockCompany(i, candidate.prefecture ?? "大阪府");
      const norm = toCandidate({ name: c.displayName, source: "gbiz", sourceConfidence: 90 }).normalizedName;
      if (norm === candidate.normalizedName) {
        return toCandidate({
          name: c.displayName,
          address: c.address,
          corporateNumber: c.corporateNumber,
          source: "gbiz",
          sourceId: c.corporateNumber,
          sourceConfidence: 90,
          rawData: { mock: true, enriched: true },
        });
      }
    }
    return null;
  }
}

export class MockPlacesProvider implements CompanyDiscoveryProvider {
  readonly name = "google_places" as const;
  isAvailable() {
    return true;
  }
  unavailableReason() {
    return null;
  }
  async search(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    await new Promise((r) => setTimeout(r, 10));
    return buildRange("google_places", query, query.limit ?? 20)
      .filter((c) => c.hasWebsite)
      .map((c) =>
        toCandidate({
          name: c.displayName,
          address: c.address,
          phone: c.phone,
          website: c.website,
          industry: query.criteria.industry ?? null,
          source: "google_places",
          sourceId: `place_${c.slug}`,
          sourceUrl: `https://www.google.com/maps/place/?q=place_id:place_${c.slug}`,
          sourceConfidence: 65,
          rawData: { mock: true, index: c.index },
        }),
      );
  }
}

export class MockWebSearchProvider implements CompanyDiscoveryProvider {
  readonly name = "web_search" as const;
  isAvailable() {
    return true;
  }
  unavailableReason() {
    return null;
  }
  async search(query: DiscoveryQuery): Promise<DiscoveryCandidate[]> {
    await new Promise((r) => setTimeout(r, 10));
    return buildRange("web_search", query, query.limit ?? 20)
      .filter((c) => c.hasWebsite)
      .map((c) =>
        toCandidate({
          // 検索結果のタイトルは説明が付くのが実態。normalizer で除去されることを確認する
          name: `${c.displayName} | 公式サイト`,
          website: c.website,
          industry: query.criteria.industry ?? null,
          source: "web_search",
          sourceId: `mock-${c.slug}.example.jp`,
          sourceUrl: `${c.website}/`,
          sourceConfidence: 30,
          rawData: { mock: true, index: c.index },
        }),
      );
  }
}

export class MockEdinetProvider implements CompanyDiscoveryProvider {
  readonly name = "edinet" as const;
  isAvailable() {
    return true;
  }
  unavailableReason() {
    return null;
  }
  async search(): Promise<DiscoveryCandidate[]> {
    // 中小企業の探索では上場企業はほぼヒットしない、という実態を再現する
    return [];
  }
}
