import { rejectOfficialSiteUrl } from "./official-site";

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
 *
 * 判定条件は rejectOfficialSiteUrl に集約している。
 * 以前はここに条件を書き写していたため、クロール側の条件と食い違い、
 * ここで外した URL をクロールが再登録し直すという行き違いが起きていた。
 */
export function recheckSiteUrl(url: string | null | undefined): SiteRecheckResult {
  const reason = rejectOfficialSiteUrl(url ?? null);
  return reason ? { ok: false, reason } : { ok: true, reason: null };
}
