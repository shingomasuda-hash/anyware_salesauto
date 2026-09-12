/**
 * 登録済み website_url の再点検。
 *
 * 公式サイトの判定基準を厳しくしても、既に登録済みの URL には
 * 遡って適用されていなかった。その結果、再クロールで法人情報DBや
 * 団体の会員一覧ページを読み続けることになっていた（実データで発生）。
 */
import { describe, expect, it } from "vitest";
import { recheckSiteUrl } from "../site-recheck";

describe("recheckSiteUrl", () => {
  // 実データで公式サイトとして登録されていた誤りURL
  const wrong = [
    ["https://houjin.goo.to/corporations/1120001008038", "法人情報DB"],
    ["https://navikyo.com/075-502-5693/", "電話番号検索"],
    ["https://tsukulink.net/osaka/city_271225/540773", "マッチングサイト"],
    ["https://sia-japan.com/company_list/654/", "団体の会員一覧"],
    ["https://kaisharesearch.com/company/detail/1120001005670/", "法人情報DB"],
    ["https://cnavi.g-search.or.jp/detail/1120001003996.html", "法人情報DB"],
    ["https://companyinformation.jp/corp/1010701009131/", "法人情報DB"],
    ["https://example.co.jp/pamphlet.pdf", "PDF"],
    ["https://www.city.osaka.lg.jp/company", "自治体"],
  ] as const;

  for (const [url, label] of wrong) {
    it(`公式サイトとしない: ${label}（${url}）`, () => {
      const r = recheckSiteUrl(url);
      expect(r.ok).toBe(false);
      expect(r.reason).toBeTruthy();
    });
  }

  it("実企業の公式サイトは通す", () => {
    for (const url of [
      "https://matsushitaseiki.co.jp",
      "https://www.dnseiki.com",
      "https://www.sankyo-seiki.com/company/outline/",
      "https://aoi-group.com/about/",
      "https://sakai-kougyou.co.jp/company/",
      "https://www.imakita-car.co.jp",
    ]) {
      expect(recheckSiteUrl(url), url).toEqual({ ok: true, reason: null });
    }
  });

  it("URL が無い場合は不適とする", () => {
    expect(recheckSiteUrl(null).ok).toBe(false);
    expect(recheckSiteUrl("").ok).toBe(false);
  });
});
