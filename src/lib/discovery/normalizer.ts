import {
  extractCity,
  extractDomain,
  extractPrefecture,
  normalizeAddress,
  normalizeCompanyName,
  normalizeCorporateNumber,
  normalizePhone,
  normalizeUrl,
  toHalfWidth,
} from "@/lib/companies/normalize";
import type { Json } from "@/db/types";
import type { DiscoveryCandidate, DiscoveryProviderName } from "./types";

export interface RawCandidateInput {
  name: string;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  corporateNumber?: string | null;
  industry?: string | null;
  source: DiscoveryProviderName;
  sourceId?: string | null;
  sourceUrl?: string | null;
  sourceConfidence: number;
  rawData?: unknown;
}

const LEGAL_FORMS = "株式会社|有限会社|合同会社|合資会社|合名会社";
/** 社名に使える文字（区切り・装飾記号は含めない） */
const NAME_CHAR = "[^\\s|｜/／、。,:：<>«»【】\\[\\]（）()]";

/** 「…の株式会社トーシン」のように法人格の後ろに社名が続く形 */
const LEGAL_FORM_THEN_NAME = new RegExp(`(${LEGAL_FORMS})\\s*(${NAME_CHAR}{1,30})`);
/**
 * 「大一精工株式会社」「Naniwa Kogyo 34株式会社」のように法人格の前に社名がある形。
 * 社名内部のスペースを許さないと複合語の社名が途中で切れるため、
 * ここだけは空白を含む文字クラスを使う（区切り記号は引き続き含めない）。
 */
const NAME_CHAR_SP = "[^|｜/／、。,:：<>«»【】\\[\\]（）()]";
const NAME_THEN_LEGAL_FORM = new RegExp(`(${NAME_CHAR_SP}{1,25}?)(${LEGAL_FORMS})`);

/**
 * 法人格の直後が助詞・語尾なら、それは社名ではない。
 * 例:「…なら山田製作所株式会社です」の「です」を社名として拾わない。
 */
const TRAILING_PARTICLE = /^(です|でした|ます|ました|だ|である|へ|を|が|は|に|も|と|や|から|まで|など|による|では|でも)/;

/**
 * 検索結果タイトルに付く説明的な語尾（社名の一部ではない）。
 * 「とは」は記事タイトルの目印として isPlausibleCompany 側で使うため、ここでは除去しない。
 */
const DESCRIPTIVE_SUFFIX = /\s*(の)?(求人情報|求人|会社概要|会社案内|会社紹介|企業情報|企業案内|公式サイト|公式ホームページ|ホームページ|採用情報|採用|事業内容|口コミ|評判)\s*$/;

/** 「株式会社山田製作所の求人情報」→「株式会社山田製作所」 */
function stripDescriptiveSuffix(value: string): string {
  let out = value.trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(DESCRIPTIVE_SUFFIX, "").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * 社名の前に付く説明句を落とす。
 * 「大阪の加工業ならイトウ精工株式会社」→「イトウ精工株式会社」
 * 社名そのものに「の」を含む場合を壊さないよう、説明句とみなせる長さのときだけ適用する。
 */
const DESCRIPTION_BOUNDARY = /^.*(?:なら|ならば|における|にある|にて|をお探しの?|の)/;
function trimLeadingDescription(part: string): string {
  if (part.length < 8) return part;
  const m = part.match(DESCRIPTION_BOUNDARY);
  if (!m) return part;
  const rest = part.slice(m[0].length).trim();
  return rest.length >= 2 ? rest : part;
}

/**
 * 検索結果タイトルの装飾を落とす。
 * 「「光電気工業」へ」「株式会社巴商会-」のように、鉤括弧・末尾の助詞・絵文字が付く。
 *
 * 落とす助詞は「へ」だけにする。「は」「と」まで落とすと
 * 「金属加工とは」のような記事タイトルが社名として通ってしまう。
 */
const TITLE_TRAILING_PARTICLE = /へ$/;
function stripTitleDecoration(value: string): string {
  let out = value.trim();
  // 絵文字・記号（「…ランキング💡」）
  out = out.replace(/[\p{Extended_Pictographic}\u2190-\u21ff\u2300-\u23ff\u25a0-\u27bf\ufe0f]+/gu, "").trim();
  // 鉤括弧・末尾記号・助詞は互いに入れ子になる（「「光電気工業」へ」）ので、変化しなくなるまで繰り返す
  for (let i = 0; i < 3; i++) {
    const before = out;
    out = out.replace(/^[「『"']+/, "").replace(/[」』"']+$/, "").trim();
    out = out.replace(/[-–—ー]+$/, "").trim();
    if (out.length >= 4) out = out.replace(TITLE_TRAILING_PARTICLE, "").trim();
    if (out === before) break;
  }
  return out;
}

/** 抽出した社名として成立するか（法人格だけ・記号だけを弾く） */
function isUsableNamePart(part: string): boolean {
  const core = part.replace(new RegExp(LEGAL_FORMS, "g"), "").replace(/[.．…・\-—–_~"']/g, "").trim();
  return core.length >= 2;
}

/**
 * 会社名から検索結果由来のノイズを落とす。
 *
 * 検索結果のタイトルは「大阪府豊中市にある金属切削加工の株式会社トーシン」のように
 * 社名が文中に埋め込まれていることが多い。区切りで切るだけでは社名を取り出せないため、
 * 法人格（株式会社等）を手がかりに社名部分だけを抽出する。
 */
export function cleanCompanyName(raw: string): string {
  const name = stripTitleDecoration(toHalfWidth(raw));

  // 1) 法人格の直後に社名が続く形を優先（「…の株式会社トーシン」）
  const after = name.match(LEGAL_FORM_THEN_NAME);
  if (after && !TRAILING_PARTICLE.test(after[2])) {
    const tail = stripDescriptiveSuffix(after[2]).replace(/[.．…]+$/, "").trim();
    if (isUsableNamePart(tail)) return `${after[1]}${tail}`;
  }

  // 2) 法人格の直前に社名がある形（「大一精工株式会社」）
  const before = name.match(NAME_THEN_LEGAL_FORM);
  if (before && isUsableNamePart(before[1])) {
    before[1] = trimLeadingDescription(before[1]);
  }
  if (before && isUsableNamePart(before[1])) {
    // 社名内部のスペースは保持し、連続した空白だけを整理する
    return stripDescriptiveSuffix(`${before[1].trim()}${before[2]}`.replace(/\s{2,}/g, " "));
  }

  // 3) 法人格が無い場合は区切りの前半を採用する
  // 「電力会社:電気料金の比較」のように : も区切りとして扱う
  let fallback = name.split(/\s*[|｜/／–—<>＞:：]\s*/)[0].trim();
  fallback = fallback.replace(/\s*[[【(（].*$/, "").trim();
  // 「アルミ加工・精密加工・微細加工の中田製作所」→「中田製作所」
  fallback = trimLeadingDescription(stripDescriptiveSuffix(fallback));
  return fallback.replace(/\s{2,}/g, " ");
}

/**
 * Provider の生データを DiscoveryCandidate へ正規化する。
 * original_name（name）は必ず保持し、照合用に normalizedName を別に持つ。
 */
export function toCandidate(input: RawCandidateInput): DiscoveryCandidate {
  const name = cleanCompanyName(input.name);
  const address = input.address?.trim() || null;
  const prefecture = extractPrefecture(address);
  const website = normalizeUrl(input.website ?? null);
  return {
    name,
    normalizedName: normalizeCompanyName(name),
    address,
    prefecture,
    city: extractCity(address, prefecture),
    phone: normalizePhone(input.phone ?? null),
    website,
    domain: extractDomain(website),
    corporateNumber: normalizeCorporateNumber(input.corporateNumber ?? null),
    industry: input.industry ?? null,
    source: input.source,
    sourceId: input.sourceId ?? null,
    sourceUrl: input.sourceUrl ?? null,
    sourceConfidence: Math.max(0, Math.min(100, Math.round(input.sourceConfidence))),
    rawData: (input.rawData ?? null) as Json,
    discoveredAt: new Date().toISOString(),
  };
}

/**
 * 業種・工程・製品の一般名詞。これらだけで構成された名前は企業名ではない。
 * 例:「電気機器」「切削加工品」「強み」（検索結果の見出しが社名として拾われたもの）
 */
const GENERIC_TERM =
  "会社|企業|上場|大手|本社|支社|支店|本店|営業所|量販店|販売店|専門店|商店|自動車|家電|食品|建材|電力|ガス|水道|市場|マーケット|電気|電子|電機|機械|機器|金属|精密|樹脂|プラスチック|ゴム|化学|化成|薬品|鉄|鋼|鉄鋼|アルミ|ステンレス|銅|切削|研削|研磨|溶接|板金|鋳造|鍛造|プレス|成形|射出成形|表面処理|熱処理|めっき|メッキ|塗装|組立|加工|製造|生産|製品|部品|装置|設備|材料|素材|工業|産業|工場|技術|品|類|業|強み|特徴|メリット|デメリット|事例|実績|価格|費用|料金|納期|種類|方法|一覧|情報|紹介";
const GENERIC_ONLY_NAME = new RegExp(`^(?:${GENERIC_TERM})+$`);

/**
 * 業界団体・協同組合。製造業の営業先ではないため候補にしない。
 * 「大阪化学工業薬品協会INDEX」「大阪府電気工事工業組合」のような一覧ページを弾く。
 */
const INDUSTRY_BODY = /(協会|工業会|商工会|商工会議所|連合会|振興会|協議会|コミッティ|組合|同業会)/;

/** 法人格・記号・空白を除いた社名の中身 */
function coreName(name: string): string {
  return name.replace(new RegExp(LEGAL_FORMS, "g"), "").replace(/[\s・･,，、。\-‐－―—_〜~&:：\/／|｜()（）「」【】]/g, "");
}

/** 一般名詞だけで構成されているか（固有名詞が1つも無い） */
function isGenericOnly(value: string): boolean {
  const core = coreName(value);
  return core.length > 0 && GENERIC_ONLY_NAME.test(core);
}

/** 日本語（かな・漢字）を含むか */
const HAS_JAPANESE = /[ぁ-んァ-ヶ一-龠]/;

/** 記事・一覧ページのタイトルに現れる語（企業名ではない） */
const NON_COMPANY_PATTERNS: RegExp[] = [
  /^(求人|採用|一覧|ランキング|まとめ|比較|おすすめ|検索結果|地域で検索)/,
  /(とは|の方法|のこと|の話|について|ガイド|コラム|ニュース)$/,
  // 「電力会社:電気&ガスセットおすすめランキング」のように語中に現れる記事表現
  /ランキング/,
  // 「京都研究所概要・アクセスマップ」のようなページ見出し
  /(アクセスマップ|アクセス|地図|概要|案内)$/,
  // 「大阪府の金属加工の会社104社」「工場 [3社]」など件数を含む一覧ページ
  /\d+\s*社/,
  // 「○○の一覧」「○○業者」「○○を探す」
  /(一覧|業者|事業者|メーカー|工場)$/,
  /(を探す|をお探し|依頼できる|見積|検索)/,
  // 「電力会社・電気料金プランランキング」「おすすめ10選」など記事タイトル
  /(ランキング|おすすめ|比較|まとめ|特集|人気)$/,
  /\d+\s*選/,
  // 都道府県・市区町村で始まる説明的タイトル
  /^(北海道|東京都|(?:京都|大阪)府|..県)(の|で|内|にある)/,
  /^[^\s]{2,6}市(の|で|内|にある)/,
];

/**
 * 企業として扱えない候補（記事タイトル・一覧ページ・一般名詞等）を除外する。
 * 法人格（株式会社等）を含む名前は、多少説明的でも企業とみなす。
 */
export function isPlausibleCompany(candidate: DiscoveryCandidate): boolean {
  const n = candidate.name;
  if (!n || n.length < 2 || n.length > 100) return false;

  // 法人格を含むものは企業名とみなす（cleanCompanyName で抽出済み）
  const hasLegalForm = /(株式会社|有限会社|合同会社|合資会社|合名会社)/.test(n);
  if (hasLegalForm) {
    // 「…をお探しなら株式会社」のように法人格の直前が助詞で終わるものは社名ではない
    if (/(なら|ならば|をお探し|お探し|など|ください|は|を|が|へ|と|より)(株式会社|有限会社|合同会社|合資会社|合名会社)$/.test(n)) return false;
    // 「株式会社会社情報」「株式会社本社工場」のように、法人格を除くと一般名詞しか残らないものは
    // 検索結果の見出しに法人格が紛れ込んだだけで、企業名ではない
    if (isGenericOnly(coreName(n))) return false;
    return n.length <= 60;
  }


  // 公的機関は営業対象にならない
  if (/(財産区|検察審査会|裁判所|役所|市役所|町役場|村役場|議会|委員会)$/.test(n)) return false;

  // 業界団体・協同組合は製造業の営業先ではない
  if (INDUSTRY_BODY.test(n)) return false;

  // 業種・工程・製品の一般名詞だけの名前は見出しを拾ったもの
  if (isGenericOnly(n)) return false;

  // 「実像~ 大阪ブランドコミッティ 家電パネル」のように語が3つ以上並ぶ日本語の見出しは社名ではない
  const tokens = n.split(/\s+/).filter(Boolean);
  if (tokens.length >= 3 && tokens.some((t) => HAS_JAPANESE.test(t))) return false;

  // 法人格が無く、地名を含む説明的なタイトルは一覧ページ・記事とみなす
  // （例:「金属加工 大阪」「大阪府の金属加工業者」）
  if (/(^|[\s・])(北海道|東京都?|京都府?|大阪府?|名古屋|横浜|福岡|札幌|神戸|[^\s]{2,3}[県市])([\s・]|$)/.test(n)) return false;

  return !NON_COMPANY_PATTERNS.some((re) => re.test(n));
}

export { normalizeAddress, normalizeCompanyName };
