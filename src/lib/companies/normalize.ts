import { PREFECTURE_NAMES } from "./constants";

const CORPORATE_SUFFIX_RE =
  /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人社団|医療法人|社会福祉法人|学校法人|特定非営利活動法人|NPO法人|\(株\)|\(有\)|\(同\)|（株）|（有）|（同）|㈱|㈲|Co\.,?\s*Ltd\.?|Inc\.?|Corp\.?|Corporation|Company|Limited|LLC|K\.K\.)/gi;

/** 全角英数記号を半角に、半角カナを全角に寄せる */
export function toHalfWidth(input: string): string {
  return input
    .replace(/[Ａ-Ｚａ-ｚ０-９！-／：-＠［-｀｛-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

/**
 * 重複判定用の企業名正規化。
 * 法人格・空白・記号を除去し、英数字は小文字化する。
 */
export function normalizeCompanyName(name: string): string {
  return toHalfWidth(name)
    .replace(CORPORATE_SUFFIX_RE, "")
    .replace(/[\s　]+/g, "")
    .replace(/[・･\.．,，、。「」『』【】\[\]()（）\-‐－―—_＿'"’”`~〜～]/g, "")
    .toLowerCase()
    .trim();
}

/** 表示用: 法人格を除いた企業名（ドメイン推定・タイトル照合用） */
export function stripCorporateSuffix(name: string): string {
  return toHalfWidth(name).replace(CORPORATE_SUFFIX_RE, "").trim();
}

/** 住所正規化: 全角→半角、空白除去、丁目/番地/号 表記の揺れを吸収 */
export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  let s = toHalfWidth(address);
  s = s.replace(/〒?\d{3}-?\d{4}/g, "");
  s = s.replace(/[\s　]+/g, "");
  s = s.replace(/[一二三四五六七八九十〇0-9０-９]+丁目/g, (m) => `${kanjiToNumber(m.replace("丁目", ""))}-`);
  s = s.replace(/(\d+)番地?(\d+)号?/g, "$1-$2");
  s = s.replace(/(\d+)番地?/g, "$1");
  s = s.replace(/(\d+)号/g, "$1");
  s = s.replace(/[ー−‐―—－]/g, "-");
  s = s.replace(/-+/g, "-").replace(/-$/, "");
  return s.toLowerCase();
}

const KANJI_DIGITS: Record<string, number> = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

export function kanjiToNumber(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  let result = 0;
  let current = 0;
  for (const ch of s) {
    if (ch === "十") {
      result += (current || 1) * 10;
      current = 0;
    } else if (ch in KANJI_DIGITS) {
      current = KANJI_DIGITS[ch];
    } else if (/\d/.test(ch)) {
      current = Number(ch);
    }
  }
  return result + current;
}

/** 住所から都道府県を抽出 */
export function extractPrefecture(address: string | null | undefined): string | null {
  if (!address) return null;
  const s = toHalfWidth(address);
  for (const p of PREFECTURE_NAMES) {
    if (s.includes(p)) return p;
  }
  return null;
}

/** 住所から市区町村を抽出（都道府県以降の最初の 市/区/郡+町村） */
export function extractCity(address: string | null | undefined, prefecture?: string | null): string | null {
  if (!address) return null;
  let s = toHalfWidth(address).replace(/〒?\d{3}-?\d{4}/g, "").trim();
  const pref = prefecture ?? extractPrefecture(s);
  if (pref) {
    const idx = s.indexOf(pref);
    if (idx >= 0) s = s.slice(idx + pref.length);
  }
  const m = s.match(/^(.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村])/);
  return m ? m[1] : null;
}

/** URL 正規化: スキーム補完、小文字ホスト、末尾スラッシュ/フラグメント/トラッキングパラメータ除去 */
export function normalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    u.hostname = u.hostname.toLowerCase();
    u.hash = "";
    const tracking = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
    tracking.forEach((k) => u.searchParams.delete(k));
    let out = u.toString();
    if (u.pathname === "/" && !u.search) out = out.replace(/\/$/, "");
    return out;
  } catch {
    return null;
  }
}

/** ドメイン取得（www. を除去、ポート除去） */
export function extractDomain(input: string | null | undefined): string | null {
  const normalized = normalizeUrl(input);
  if (!normalized) return null;
  try {
    const host = new URL(normalized).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** 電話番号正規化: ハイフン統一、全角→半角 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = toHalfWidth(input).replace(/[()（）\s]/g, "").replace(/[ー−‐―—－]/g, "-");
  const digits = s.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) return null;
  return s.includes("-") ? s : digits;
}

/** 法人番号 (13桁) の検証 */
export function normalizeCorporateNumber(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const s = toHalfWidth(String(input)).replace(/\D/g, "");
  return s.length === 13 ? s : null;
}

export function parseEmployeeCount(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) && input > 0 ? Math.round(input) : null;
  const m = toHalfWidth(input).replace(/,/g, "").match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return n > 0 ? n : null;
}
