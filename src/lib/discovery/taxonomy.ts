/**
 * 業種の細分化（Query Generation 用）。
 * ユーザーが「製造業」を選んだとき、単一クエリではなく細分化した複数クエリへ展開する。
 */
export interface IndustrySubcategory {
  key: string;
  label: string;
  /** 検索エンジン / Places 用の検索語 */
  searchTerms: string[];
}

export const INDUSTRY_SUBCATEGORIES: Record<string, IndustrySubcategory[]> = {
  manufacturing: [
    { key: "metal_processing", label: "金属加工", searchTerms: ["金属加工", "板金加工", "金属プレス"] },
    { key: "precision_processing", label: "精密加工", searchTerms: ["精密加工", "精密部品", "NC旋盤"] },
    { key: "machinery", label: "機械製造", searchTerms: ["機械製造", "産業機械", "機械加工"] },
    { key: "automotive_parts", label: "自動車部品", searchTerms: ["自動車部品", "輸送機器部品"] },
    { key: "electronics", label: "電気・電子機器", searchTerms: ["電気機器", "電子部品", "制御機器"] },
    { key: "plastic", label: "樹脂・プラスチック", searchTerms: ["樹脂加工", "プラスチック成形", "射出成形"] },
    { key: "chemical", label: "化学工業", searchTerms: ["化学工業", "化成品", "塗料製造"] },
    { key: "food", label: "食品製造", searchTerms: ["食品製造", "食品加工"] },
    { key: "printing", label: "印刷", searchTerms: ["印刷会社", "商業印刷"] },
    { key: "textile", label: "繊維・衣料", searchTerms: ["繊維製造", "縫製", "アパレル製造"] },
    { key: "construction_materials", label: "建材・窯業", searchTerms: ["建材製造", "窯業", "コンクリート製品"] },
    { key: "general_parts", label: "部品製造全般", searchTerms: ["部品製造", "製作所", "工場"] },
  ],
  construction: [
    { key: "general_construction", label: "総合建設", searchTerms: ["建設会社", "総合建設業"] },
    { key: "architecture", label: "建築", searchTerms: ["建築会社", "工務店"] },
    { key: "civil_engineering", label: "土木", searchTerms: ["土木工事", "土木会社"] },
    { key: "electrical_work", label: "電気工事", searchTerms: ["電気工事", "電気設備工事"] },
    { key: "plumbing", label: "管工事・設備", searchTerms: ["管工事", "空調設備工事", "給排水設備"] },
    { key: "interior", label: "内装・リフォーム", searchTerms: ["内装工事", "リフォーム会社"] },
  ],
  it: [
    { key: "software", label: "ソフトウェア開発", searchTerms: ["ソフトウェア開発", "システム開発"] },
    { key: "si", label: "システムインテグレーション", searchTerms: ["SIer", "システムインテグレーター"] },
    { key: "web", label: "Web制作・受託開発", searchTerms: ["Web制作会社", "受託開発"] },
    { key: "infra", label: "インフラ・通信", searchTerms: ["ネットワーク構築", "通信工事"] },
    { key: "saas", label: "SaaS・自社サービス", searchTerms: ["SaaS", "自社サービス開発"] },
  ],
  wholesale_retail: [
    { key: "wholesale", label: "卸売", searchTerms: ["卸売業", "商社"] },
    { key: "retail", label: "小売", searchTerms: ["小売業", "販売店"] },
    { key: "ec", label: "EC・通販", searchTerms: ["EC事業", "通信販売"] },
    { key: "trading", label: "専門商社", searchTerms: ["専門商社", "機械商社"] },
  ],
  logistics: [
    { key: "trucking", label: "運送", searchTerms: ["運送会社", "貨物運送"] },
    { key: "warehouse", label: "倉庫", searchTerms: ["倉庫業", "物流倉庫"] },
    { key: "delivery", label: "配送", searchTerms: ["配送業", "宅配"] },
  ],
  medical_welfare: [
    { key: "nursing_care", label: "介護", searchTerms: ["介護事業所", "訪問介護", "デイサービス"] },
    { key: "clinic", label: "医療機関", searchTerms: ["クリニック", "医療法人"] },
    { key: "welfare", label: "福祉", searchTerms: ["福祉施設", "障害福祉サービス"] },
  ],
  professional: [
    { key: "consulting", label: "コンサルティング", searchTerms: ["コンサルティング会社", "経営コンサル"] },
    { key: "design", label: "設計・デザイン", searchTerms: ["設計事務所", "デザイン会社"] },
    { key: "advertising", label: "広告", searchTerms: ["広告代理店", "販促支援"] },
    { key: "accounting", label: "会計・法務", searchTerms: ["税理士法人", "会計事務所"] },
  ],
  services: [
    { key: "staffing", label: "人材サービス", searchTerms: ["人材派遣", "人材紹介"] },
    { key: "cleaning", label: "清掃・メンテナンス", searchTerms: ["清掃会社", "ビルメンテナンス"] },
    { key: "security", label: "警備", searchTerms: ["警備会社"] },
    { key: "maintenance", label: "設備保守", searchTerms: ["設備保守", "機械メンテナンス"] },
  ],
  food_service: [
    { key: "restaurant", label: "飲食店運営", searchTerms: ["飲食店運営", "レストラン運営"] },
    { key: "hotel", label: "宿泊", searchTerms: ["ホテル", "旅館"] },
    { key: "catering", label: "給食・ケータリング", searchTerms: ["給食サービス", "ケータリング"] },
  ],
  real_estate: [
    { key: "brokerage", label: "売買・仲介", searchTerms: ["不動産会社", "不動産仲介"] },
    { key: "management", label: "賃貸管理", searchTerms: ["賃貸管理", "不動産管理"] },
    { key: "developer", label: "開発", searchTerms: ["不動産開発", "デベロッパー"] },
  ],
  education: [
    { key: "school", label: "学習塾・スクール", searchTerms: ["学習塾", "スクール運営"] },
    { key: "training", label: "企業研修", searchTerms: ["企業研修", "人材育成"] },
  ],
  lifestyle: [
    { key: "beauty", label: "美容", searchTerms: ["美容室", "エステサロン"] },
    { key: "fitness", label: "フィットネス", searchTerms: ["フィットネスクラブ", "ジム運営"] },
    { key: "travel", label: "旅行", searchTerms: ["旅行会社"] },
  ],
  finance: [{ key: "finance_general", label: "金融・保険", searchTerms: ["保険代理店", "金融サービス"] }],
  agriculture: [{ key: "agriculture_general", label: "農林水産", searchTerms: ["農業法人", "水産加工"] }],
  energy: [{ key: "energy_general", label: "エネルギー", searchTerms: ["電気工事", "エネルギー事業", "太陽光発電"] }],
  other: [],
};

export function getSubcategories(industryKey: string | undefined): IndustrySubcategory[] {
  if (!industryKey) return [];
  return INDUSTRY_SUBCATEGORIES[industryKey] ?? [];
}

export function findSubcategory(industryKey: string | undefined, subKey: string | undefined): IndustrySubcategory | undefined {
  if (!subKey) return undefined;
  return getSubcategories(industryKey).find((s) => s.key === subKey);
}

/** 全業種の細分カテゴリ（UI のセレクト用） */
export function allSubcategoryOptions(industryKey: string | undefined): { key: string; label: string }[] {
  return getSubcategories(industryKey).map((s) => ({ key: s.key, label: s.label }));
}
