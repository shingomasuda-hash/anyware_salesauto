import { INDUSTRIES } from "@/lib/companies/constants";
import { findSubcategory, getSubcategories } from "./taxonomy";
import type { DiscoveryCriteria } from "./types";

/**
 * 検索条件から、検索エンジン / Places 用の検索語を生成する。
 * 「大阪府 製造業」1本ではなく、業種を細分化して複数の検索語へ展開する。
 * ただし API 乱打を避けるため、生成数は maxTerms で必ず打ち切る。
 */
export function generateSearchTerms(criteria: DiscoveryCriteria, maxTerms = 12): string[] {
  const area = [criteria.prefecture, criteria.city].filter(Boolean).join(" ");
  const industryLabel = INDUSTRIES.find((i) => i.key === criteria.industry)?.label;
  const terms: string[] = [];

  const push = (term: string) => {
    const t = term.trim().replace(/\s+/g, " ");
    if (t && !terms.includes(t)) terms.push(t);
  };

  // ユーザー指定キーワードは最優先（意図が最も明確なため）
  for (const kw of criteria.keywords ?? []) push([area, kw].filter(Boolean).join(" "));

  // 業種詳細が指定されていればそれだけを展開する
  const explicitSub = findSubcategory(criteria.industry, criteria.industrySubcategory);
  if (explicitSub) {
    for (const term of explicitSub.searchTerms) push([area, term].filter(Boolean).join(" "));
  } else {
    // 業種そのもの → 細分カテゴリの順に展開
    if (industryLabel) push([area, industryLabel].filter(Boolean).join(" "));
    for (const sub of getSubcategories(criteria.industry)) {
      push([area, sub.searchTerms[0]].filter(Boolean).join(" "));
    }
  }

  for (const kw of criteria.industryKeywords ?? []) push([area, kw].filter(Boolean).join(" "));

  // 採用条件が指定されている場合は採用系の語を足す（採用ページを持つ企業を発見しやすい）
  if (criteria.recruitingRequired && terms.length < maxTerms) {
    const base = explicitSub?.searchTerms[0] ?? industryLabel;
    if (base) push([area, base, "求人 採用"].filter(Boolean).join(" "));
  }

  if (terms.length === 0 && area) push(area);
  return terms.slice(0, maxTerms);
}

/**
 * 検索語に付けるサフィックス（公開情報源を狙う）。
 * 自治体・産業振興機関・工業会などの公開ページから企業候補を発見するためのもの。
 * 実際に取得できるかは Provider（検索エンジン）と robots.txt に従う。
 */
export const PUBLIC_DIRECTORY_HINTS = ["企業一覧", "企業情報 一覧", "工業会 会員", "商工会議所 会員", "企業ガイド"] as const;

export function generateDirectoryTerms(criteria: DiscoveryCriteria, maxTerms = 3): string[] {
  const area = [criteria.prefecture, criteria.city].filter(Boolean).join(" ");
  const industryLabel = INDUSTRIES.find((i) => i.key === criteria.industry)?.label;
  if (!area) return [];
  return PUBLIC_DIRECTORY_HINTS.slice(0, maxTerms).map((hint) => [area, industryLabel, hint].filter(Boolean).join(" "));
}

/**
 * GビズINFO の法人名検索に使う語を生成する。
 *
 * GビズINFO は業種で絞り込めず、結果は法人番号順に返るため、
 * 条件を都道府県だけにすると先頭が財産区・裁判所などの公的機関で埋まる。
 * 業種に対応する「法人名に現れやすい語」で引くことで、実在の事業会社を狙う。
 */
export function generateGbizNameKeywords(criteria: DiscoveryCriteria, maxTerms = 8): string[] {
  const terms: string[] = [];
  const push = (t: string) => {
    const v = t.trim();
    // GビズINFO の name は50文字以内
    if (v && v.length <= 50 && !terms.includes(v)) terms.push(v);
  };

  // ユーザー指定キーワードが最優先（意図が最も明確）
  for (const kw of criteria.keywords ?? []) push(kw);

  // 業種詳細が指定されていればその語を優先する
  const sub = findSubcategory(criteria.industry, criteria.industrySubcategory);
  if (sub) for (const t of sub.searchTerms) push(t);

  for (const k of INDUSTRIES.find((i) => i.key === criteria.industry)?.nameKeywords ?? []) push(k);

  return terms.slice(0, maxTerms);
}
