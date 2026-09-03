/** 都道府県（JIS X 0401 コード順） */
export const PREFECTURES: { code: string; name: string }[] = [
  { code: "01", name: "北海道" }, { code: "02", name: "青森県" }, { code: "03", name: "岩手県" }, { code: "04", name: "宮城県" },
  { code: "05", name: "秋田県" }, { code: "06", name: "山形県" }, { code: "07", name: "福島県" }, { code: "08", name: "茨城県" },
  { code: "09", name: "栃木県" }, { code: "10", name: "群馬県" }, { code: "11", name: "埼玉県" }, { code: "12", name: "千葉県" },
  { code: "13", name: "東京都" }, { code: "14", name: "神奈川県" }, { code: "15", name: "新潟県" }, { code: "16", name: "富山県" },
  { code: "17", name: "石川県" }, { code: "18", name: "福井県" }, { code: "19", name: "山梨県" }, { code: "20", name: "長野県" },
  { code: "21", name: "岐阜県" }, { code: "22", name: "静岡県" }, { code: "23", name: "愛知県" }, { code: "24", name: "三重県" },
  { code: "25", name: "滋賀県" }, { code: "26", name: "京都府" }, { code: "27", name: "大阪府" }, { code: "28", name: "兵庫県" },
  { code: "29", name: "奈良県" }, { code: "30", name: "和歌山県" }, { code: "31", name: "鳥取県" }, { code: "32", name: "島根県" },
  { code: "33", name: "岡山県" }, { code: "34", name: "広島県" }, { code: "35", name: "山口県" }, { code: "36", name: "徳島県" },
  { code: "37", name: "香川県" }, { code: "38", name: "愛媛県" }, { code: "39", name: "高知県" }, { code: "40", name: "福岡県" },
  { code: "41", name: "佐賀県" }, { code: "42", name: "長崎県" }, { code: "43", name: "熊本県" }, { code: "44", name: "大分県" },
  { code: "45", name: "宮崎県" }, { code: "46", name: "鹿児島県" }, { code: "47", name: "沖縄県" },
];

export const PREFECTURE_NAMES = PREFECTURES.map((p) => p.name);

export function prefectureCode(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  return PREFECTURES.find((p) => p.name === name)?.code;
}

/**
 * 業種（日本標準産業分類 大分類ベース）。
 * gbizKeywords は GビズINFO の業種名/事業概要に対する部分一致フィルタ用。
 */
export interface IndustryDef {
  key: string;
  label: string;
  /** GビズINFO business_item 等に含まれる語 */
  gbizKeywords: string[];
}

export const INDUSTRIES: IndustryDef[] = [
  { key: "manufacturing", label: "製造業", gbizKeywords: ["製造", "工業", "メーカー", "加工"] },
  { key: "construction", label: "建設業", gbizKeywords: ["建設", "建築", "土木", "工務店", "設備工事", "電気工事"] },
  { key: "it", label: "情報通信業", gbizKeywords: ["情報", "通信", "ソフトウェア", "システム", "IT", "インターネット"] },
  { key: "wholesale_retail", label: "卸売業・小売業", gbizKeywords: ["卸売", "小売", "販売", "商事", "商店"] },
  { key: "logistics", label: "運輸業・郵便業", gbizKeywords: ["運輸", "運送", "物流", "倉庫", "配送"] },
  { key: "real_estate", label: "不動産業", gbizKeywords: ["不動産", "賃貸", "住宅"] },
  { key: "food_service", label: "宿泊業・飲食サービス業", gbizKeywords: ["飲食", "レストラン", "ホテル", "宿泊", "フード"] },
  { key: "medical_welfare", label: "医療・福祉", gbizKeywords: ["医療", "福祉", "介護", "クリニック", "病院", "薬局"] },
  { key: "education", label: "教育・学習支援業", gbizKeywords: ["教育", "学習", "スクール", "塾"] },
  { key: "professional", label: "学術研究・専門サービス業", gbizKeywords: ["コンサル", "会計", "税理士", "法律", "設計", "デザイン", "広告"] },
  { key: "services", label: "サービス業（その他）", gbizKeywords: ["サービス", "人材", "清掃", "警備", "整備"] },
  { key: "finance", label: "金融業・保険業", gbizKeywords: ["金融", "保険", "信用"] },
  { key: "agriculture", label: "農業・林業・漁業", gbizKeywords: ["農業", "農園", "林業", "漁業", "水産"] },
  { key: "energy", label: "電気・ガス・熱供給・水道業", gbizKeywords: ["電力", "ガス", "エネルギー", "水道"] },
  { key: "lifestyle", label: "生活関連サービス業・娯楽業", gbizKeywords: ["美容", "理容", "エステ", "フィットネス", "娯楽", "旅行"] },
  { key: "other", label: "その他", gbizKeywords: [] },
];

export function industryLabel(key: string | null | undefined): string | undefined {
  return INDUSTRIES.find((i) => i.key === key)?.label;
}

/** 従業員規模レンジ */
export interface EmployeeRangeDef {
  key: string;
  label: string;
  min: number;
  max: number | null;
}

export const EMPLOYEE_RANGES: EmployeeRangeDef[] = [
  { key: "1-9", label: "1〜9名", min: 1, max: 9 },
  { key: "10-19", label: "10〜19名", min: 10, max: 19 },
  { key: "20-49", label: "20〜49名", min: 20, max: 49 },
  { key: "50-99", label: "50〜99名", min: 50, max: 99 },
  { key: "100-299", label: "100〜299名", min: 100, max: 299 },
  { key: "300-999", label: "300〜999名", min: 300, max: 999 },
  { key: "1000+", label: "1000名以上", min: 1000, max: null },
];

export function employeeRangeFromCount(count: number | null | undefined): string | null {
  if (count === null || count === undefined || Number.isNaN(count) || count <= 0) return null;
  const r = EMPLOYEE_RANGES.find((x) => count >= x.min && (x.max === null || count <= x.max));
  return r?.key ?? null;
}

export function employeeRangeLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return EMPLOYEE_RANGES.find((r) => r.key === key)?.label ?? key;
}

/** 企業規模プリセット（検索UI用） */
export const COMPANY_SIZE_PRESETS: { key: string; label: string; min: number; max: number | null }[] = [
  { key: "any", label: "指定なし", min: 0, max: null },
  { key: "micro", label: "小規模（〜19名）", min: 1, max: 19 },
  { key: "small", label: "小〜中規模（20〜300名）", min: 20, max: 300 },
  { key: "mid", label: "中規模（100〜999名）", min: 100, max: 999 },
  { key: "large", label: "大規模（1000名〜）", min: 1000, max: null },
];

/** 法人種別（GビズINFO corporate_type コード） */
export const CORPORATE_TYPES: { code: string; label: string; suffix: string[] }[] = [
  { code: "301", label: "株式会社", suffix: ["株式会社"] },
  { code: "302", label: "有限会社", suffix: ["有限会社"] },
  { code: "303", label: "合名会社", suffix: ["合名会社"] },
  { code: "304", label: "合資会社", suffix: ["合資会社"] },
  { code: "305", label: "合同会社", suffix: ["合同会社"] },
  { code: "399", label: "その他の設立登記法人", suffix: ["一般社団法人", "一般財団法人", "医療法人", "社会福祉法人", "学校法人", "NPO法人", "特定非営利活動法人"] },
];

export const SALES_RANKS: { key: "A" | "B" | "C" | "D"; label: string; description: string }[] = [
  { key: "A", label: "A", description: "非常に営業優先度が高い" },
  { key: "B", label: "B", description: "営業候補" },
  { key: "C", label: "C", description: "条件次第" },
  { key: "D", label: "D", description: "現状優先度低い" },
];
