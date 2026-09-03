import { INDUSTRIES } from "@/lib/companies/constants";
import type { CompanySearchConditions, GbizHojin, GbizProvider, GbizSearchPage } from "./types";

const WORDS = ["sakura", "hikari", "daiwa", "kansai", "naniwa", "yamato", "asahi", "shinsei", "kyowa", "meiwa", "taiyo", "fuji", "tokai", "nishi", "higashi", "minami", "kita", "chuo", "heiwa", "eiwa", "kokusai", "sanwa", "nichiei", "toyo", "seiko", "koyo", "nissin", "marui", "wako", "kyoei"];
const SUFFIX = ["seisakusho", "kogyo", "tech", "industry", "kikai", "seiki", "kinzoku", "denki", "kasei", "shoji", "system", "works", "engineering", "planning", "service"];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * GビズINFO モック。条件から決定論的にダミー法人を生成する。
 * 同じ slug は毎回同じ法人番号になるため、重複排除の動作も確認できる。
 */
export class MockGbizProvider implements GbizProvider {
  readonly name = "mock" as const;
  private readonly total = 180;

  private build(index: number, conditions: CompanySearchConditions): GbizHojin {
    const w = WORDS[index % WORDS.length];
    const s = SUFFIX[Math.floor(index / WORDS.length) % SUFFIX.length];
    const slug = `${w}-${s}-${index}`;
    const h = hash(slug);
    const pref = conditions.prefecture ?? "大阪府";
    const city = conditions.city ?? ["大阪市中央区", "大阪市北区", "東大阪市", "堺市堺区", "八尾市", "吹田市"][h % 6];
    const industry = INDUSTRIES.find((i) => i.key === conditions.industry) ?? INDUSTRIES[0];
    const employee = 5 + (h % 400);
    const displayName = `${w.charAt(0).toUpperCase()}${w.slice(1)} ${s.charAt(0).toUpperCase()}${s.slice(1)} ${index}株式会社`;
    const hasUrl = h % 9 !== 0;
    return {
      corporate_number: String(1000000000000 + (h % 8999999999999)),
      name: displayName,
      kana: `${w}${s}${index}かぶしきがいしゃ`,
      location: `${pref}${city}本町${1 + (h % 4)}丁目${1 + ((h >> 3) % 20)}-${1 + ((h >> 7) % 30)}`,
      postal_code: `541${String(h % 10000).padStart(4, "0")}`,
      status: "101",
      company_url: hasUrl ? `https://mock-${slug}.example.jp` : null,
      business_summary: `${industry.label}。${industry.gbizKeywords[0] ?? ""}を中心に事業を展開。`,
      business_items: [industry.label],
      employee_number: employee,
      capital_stock: 10_000_000 * (1 + (h % 10)),
      date_of_establishment: `${1960 + (h % 60)}-04-01`,
      representative_name: ["山田 太郎", "佐藤 花子", "田中 一郎", "鈴木 次郎"][h % 4],
      representative_position: "代表取締役",
    };
  }

  async search(conditions: CompanySearchConditions, page: number, limit: number): Promise<GbizSearchPage> {
    const start = (page - 1) * limit;
    const items: GbizHojin[] = [];
    for (let i = start; i < Math.min(start + limit, this.total); i++) {
      items.push(this.build(i, conditions));
    }
    // 実APIのレイテンシを軽く模倣
    await new Promise((r) => setTimeout(r, 50));
    return { items, page, totalPages: Math.ceil(this.total / limit), totalCount: this.total };
  }

  async detail(): Promise<GbizHojin | null> {
    return null;
  }
}
