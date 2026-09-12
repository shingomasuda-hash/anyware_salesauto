import { extractDomain } from "./normalize";
import { isNonHtmlUrl, isNonOfficialDomain, looksLikeCorporateDatabaseUrl, looksLikeDirectoryPageUrl } from "./official-site";

export interface SiteRecheckResult {
  ok: boolean;
  /** 公式サイトとして不適切と判断した理由 */
  reason: string | null;
}

/**
 * 登録済みの website_url を、現在の判定基準で再点検する。
 *
 * 公式サイトの判定基準は実データ検証で何度も厳しくしてきたが、
 * 既に登録された企業の URL には遡って適用されていなかった。
 * その結果、法人情報DB・電話番号検索・団体の会員一覧ページなどが
 * 「公式サイト」として残り、再クロールでもそこを読み続けてしまう。
 */
export function recheckSiteUrl(url: string | null | undefined): SiteRecheckResult {
  if (!url) return { ok: false, reason: "URL が設定されていません" };
  const domain = extractDomain(url);
  if (!domain) return { ok: false, reason: "URL を解釈できません" };
  if (isNonOfficialDomain(domain)) return { ok: false, reason: `公式サイトにならないドメイン（${domain}）` };
  if (looksLikeCorporateDatabaseUrl(url)) return { ok: false, reason: "法人情報データベースのページ" };
  if (looksLikeDirectoryPageUrl(url)) return { ok: false, reason: "企業ディレクトリ・名簿のページ" };
  if (isNonHtmlUrl(url)) return { ok: false, reason: "HTML ページではありません" };
  return { ok: true, reason: null };
}
