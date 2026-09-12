import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SITE_THRESHOLD,
  checkDomainOwnership,
  isOrganizationDomain,
  rejectOfficialSiteUrl,
  scoreOfficialSiteCandidate,
} from "../official-site";
import { recheckSiteUrl } from "../site-recheck";

/**
 * 実データで「公式サイト」として登録されてしまった URL。
 * db:recheck-sites で外したのに、次のクロールが同じ URL を confidence 100 で
 * 再登録していた。判定条件が crawl-job と site-recheck で別々だったため。
 */
const REJECTED_URLS = [
  "https://korps.jp/corporations/3265903",
  "https://houjin.j-bdb.com/1120001049412",
  "https://toukibo.ai-con.lawyer/search-service/result/1120001000201",
  "https://companyinformation.jp/corp/1010701009131/",
  "https://compalyze.co.jp/company/1120001004045",
  "https://kaisharesearch.com/company/detail/1120001005670/",
  "https://helloboss.com/corp/1120001013483",
  "https://cnavi.g-search.or.jp/detail/1120001003996.html",
  "https://navikyo.com/075-502-5693/",
  "https://tsukulink.net/osaka/city_271225/540773",
  // 団体専用ドメイン（株式会社は登録できない）
  "https://www.aipf.or.jp/mono/gyoshu/tekko/436/",
  "https://www.kobekk.or.jp/member/daisintekkosho.html",
  "https://www.mikicci.or.jp/cci/member_info.php?mid=56",
  "https://www.mizu.or.jp/union/ashida/",
  "https://www.oky.or.jp/list/554/",
];

const OFFICIAL_URLS = [
  "https://hatataki.co.jp/company/",
  "https://www.toyo-mech.com/company",
  "http://ohskchuck.web.fc2.com/ohashi-011.html",
  "https://sato-tekk.sakura.ne.jp/sub1.html",
  "https://www.chiyoda-seiki.co.jp/company/foothold.html",
];

describe("rejectOfficialSiteUrl（公式サイト判定の共有ゲート）", () => {
  it.each(REJECTED_URLS)("公式サイトとして認めない: %s", (url) => {
    expect(rejectOfficialSiteUrl(url)).not.toBeNull();
  });

  it.each(OFFICIAL_URLS)("実在する公式サイトは落とさない: %s", (url) => {
    expect(rejectOfficialSiteUrl(url)).toBeNull();
  });

  it("団体・学校専用ドメインを判定できる", () => {
    expect(isOrganizationDomain("kobekk.or.jp")).toBe(true);
    expect(isOrganizationDomain("example.gr.jp")).toBe(true);
    expect(isOrganizationDomain("example.ac.jp")).toBe(true);
    expect(isOrganizationDomain("hatataki.co.jp")).toBe(false);
    // .ne.jp はレンタルサーバ等で企業も使うため落とさない
    expect(isOrganizationDomain("sato-tekk.sakura.ne.jp")).toBe(false);
  });
});

describe("GビズINFO登録URLでもゲートを通す", () => {
  // 出所の基礎点（GビズINFO=55点）だけで閾値を超えていたため、
  // GビズINFO に誤登録された URL がそのまま公式サイトになっていた。
  it.each(REJECTED_URLS)("出所が gbiz でも閾値未満にする: %s", (url) => {
    const score = scoreOfficialSiteCandidate(
      { companyName: "株式会社葉田鋳造鉄工所", address: "大阪府大阪市鶴見区", corporateNumber: "1120001049412" },
      { url, source: "gbiz", title: "株式会社葉田鋳造鉄工所", pageText: "株式会社葉田鋳造鉄工所 大阪府大阪市鶴見区 1120001049412 会社概要" },
    );
    expect(score.confidence).toBeLessThan(OFFICIAL_SITE_THRESHOLD);
  });
});

describe("再点検とスコアリングの判定が一致する", () => {
  // 別々に条件を書き写していたため、一方が外した URL を他方が採用していた。
  // 同じ URL に対して両者が同じ結論になることをテストで固定する。
  it.each([...REJECTED_URLS, ...OFFICIAL_URLS])("%s", (url) => {
    const rejected = rejectOfficialSiteUrl(url) !== null;
    expect(recheckSiteUrl(url).ok).toBe(!rejected);
    if (rejected) {
      const score = scoreOfficialSiteCandidate({ companyName: "株式会社テスト" }, { url, source: "gbiz" });
      expect(score.confidence).toBeLessThan(OFFICIAL_SITE_THRESHOLD);
    }
  });
});

describe("checkDomainOwnership（ドメインの持ち主の確認）", () => {
  it("団体のトップページ配下のページは公式サイトにしない", () => {
    const result = checkDomainOwnership({
      companyName: "株式会社大進鉄工所",
      url: "https://kobe-sugureta.jp/company/daishin/",
      rootTitle: "神戸のすぐれた技術",
      rootText: "神戸市の優れた技術を紹介するサイトです。",
    });
    expect(result.owned).toBe(false);
  });

  it("求人媒体の企業ページは公式サイトにしない", () => {
    const result = checkDomainOwnership({
      companyName: "株式会社マサダ製作所",
      url: "https://en-gage.net/masada/",
      rootTitle: "engage（エンゲージ）｜求人管理",
      rootText: "engage は無料で使える採用支援ツールです。",
    });
    expect(result.owned).toBe(false);
  });

  it("トップページに社名があれば公式サイトと認める", () => {
    const result = checkDomainOwnership({
      companyName: "株式会社葉田鋳造鉄工所",
      url: "https://hatataki.co.jp/company/",
      rootTitle: "鋳物のことなら",
      rootText: "ごあいさつ … 株式会社葉田鋳造鉄工所 大阪府大阪市",
    });
    expect(result.owned).toBe(true);
  });

  it("ドメイン名が社名に由来すれば取得せずに認める", () => {
    const result = checkDomainOwnership({ companyName: "TOYO MECH株式会社", url: "https://www.toyo-mech.com/company" });
    expect(result.owned).toBe(true);
  });

  it("候補がトップページそのものなら認める", () => {
    const result = checkDomainOwnership({ companyName: "株式会社和田山精機", url: "https://wadayamaseiki.co.jp" });
    expect(result.owned).toBe(true);
  });

  it("トップページを取得できなかったときは落とさない（保留）", () => {
    const result = checkDomainOwnership({
      companyName: "株式会社佐藤鉄工所",
      url: "https://sato-tekk.sakura.ne.jp/sub1.html",
      rootTitle: null,
      rootText: null,
    });
    expect(result.owned).toBe(true);
  });
});

describe("法人情報DBの判定はホスト名で行う", () => {
  it("会社概要ページを /kaisha/ や /hojin/ に置く実在サイトは落とさない", () => {
    // パス全体で kaisha / hojin を見ていたため、実在の中小企業サイトを落とす恐れがあった
    expect(rejectOfficialSiteUrl("https://www.example-seiki.co.jp/kaisha/gaiyou.html")).toBeNull();
    expect(rejectOfficialSiteUrl("https://www.example-tekko.co.jp/hojin/about.html")).toBeNull();
  });

  it("ホスト名が法人情報DBのものは落とす", () => {
    expect(rejectOfficialSiteUrl("https://houjin.example.com/abc")).not.toBeNull();
    expect(rejectOfficialSiteUrl("https://toukibo.example.com/result/xyz")).not.toBeNull();
  });

  it("法人番号が含まれる URL は落とす", () => {
    expect(rejectOfficialSiteUrl("https://example.com/detail/1120001003996.html")).not.toBeNull();
  });
});
