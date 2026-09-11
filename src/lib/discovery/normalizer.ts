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
const DESCRIPTIVE_SUFFIX = /\s*(の)?(求人情報|求人|会社概要|企業情報|公式サイト|公式ホームページ|ホームページ|採用情報|採用|事業内容|口コミ|評判)\s*$/;

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
  const name = toHalfWidth(raw).trim();

  // 1) 法人格の直後に社名が続く形を優先（「…の株式会社トーシン」）
  const after = name.match(LEGAL_FORM_THEN_NAME);
  if (after && !TRAILING_PARTICLE.test(after[2])) {
    const tail = stripDescriptiveSuffix(after[2]).replace(/[.．…]+$/, "").trim();
    if (isUsableNamePart(tail)) return `${after[1]}${tail}`;
  }

  // 2) 法人格の直前に社名がある形（「大一精工株式会社」）
  const before = name.match(NAME_THEN_LEGAL_FORM);
  if (before && isUsableNamePart(before[1])) {
    // 社名内部のスペースは保持し、連続した空白だけを整理する
    return stripDescriptiveSuffix(`${before[1].trim()}${before[2]}`.replace(/\s{2,}/g, " "));
  }

  // 3) 法人格が無い場合は区切りの前半を採用する
  let fallback = name.split(/\s*[|｜/／–—<>＞]\s*/)[0].trim();
  fallback = fallback.replace(/\s*[[【(（].*$/, "").trim();
  return stripDescriptiveSuffix(fallback).replace(/\s{2,}/g, " ");
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

/** 記事・一覧ページのタイトルに現れる語（企業名ではない） */
const NON_COMPANY_PATTERNS: RegExp[] = [
  /^(求人|採用|一覧|ランキング|まとめ|比較|おすすめ|検索結果|地域で検索)/,
  /(とは|の方法|について|ガイド|コラム|ニュース)$/,
  // 「大阪府の金属加工の会社104社」「工場 [3社]」など件数を含む一覧ページ
  /\d+\s*社/,
  // 「○○の一覧」「○○業者」「○○を探す」
  /(一覧|業者|事業者|メーカー|工場)$/,
  /(を探す|をお探し|依頼できる|見積|検索)/,
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
  if (hasLegalForm) return n.length <= 60;

  // 公的機関は営業対象にならない
  if (/(財産区|検察審査会|裁判所|役所|市役所|町役場|村役場|議会|委員会)$/.test(n)) return false;

  // 法人格が無く、地名を含む説明的なタイトルは一覧ページ・記事とみなす
  // （例:「金属加工 大阪」「大阪府の金属加工業者」）
  if (/(^|[\s・])(北海道|東京都?|京都府?|大阪府?|名古屋|横浜|福岡|札幌|神戸|[^\s]{2,3}[県市])([\s・]|$)/.test(n)) return false;

  return !NON_COMPANY_PATTERNS.some((re) => re.test(n));
}

export { normalizeAddress, normalizeCompanyName };
