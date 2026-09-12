import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SITE_THRESHOLD,
  checkDomainOwnership,
  companyCoreName,
  isOrganizationDomain,
  looksLikeRecordPageUrl,
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
  it("企業を並べた団体サイトの配下ページは公式サイトにしない", () => {
    // ポータルのトップページには掲載企業が並ぶ。それを根拠に落とす。
    const result = checkDomainOwnership({
      companyName: "株式会社大進鉄工所",
      url: "https://kobe-sugureta.jp/company/daishin/",
      rootTitle: "神戸のすぐれた技術｜掲載企業一覧",
      rootText: [
        "株式会社アルファ工業",
        "株式会社ベータ製作所",
        "有限会社ガンマ精機",
        "株式会社デルタ鉄工",
        "株式会社イプシロン機械",
        "有限会社ゼータ金属",
      ].join(" / "),
    });
    expect(result.owned).toBe(false);
  });

  it("1社ごとに識別子を振るページは、トップページを見る前に落とす", () => {
    // ポータルの1件分のページは URL の形で分かるため、トップページの内容に依存しない
    const result = checkDomainOwnership({
      companyName: "菅原精機株式会社",
      url: "https://www.monodukuri-kyoto.jp/company/4630/",
      rootTitle: "京都のものづくり",
      rootText: "ものづくり企業をご紹介します。",
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

describe("自社・グループのドメインを名簿と誤判定しない", () => {
  // 実データで3社の自社ドメインを誤って外した。companyNameTokens は英字しか
  // 抽出しないため日本語社名では常に空になり、「トップページに社名が完全一致で
  // 出るか」だけに依存していたのが原因。
  it("社名を画像で出している自社サイトは落とさない", () => {
    const result = checkDomainOwnership({
      companyName: "大東プレス工業株式会社",
      url: "http://www.daito-press.co.jp/company",
      rootTitle: "プレス加工・金型設計",
      rootText: "高精度なプレス加工でお応えします。製品情報 会社案内 お問い合わせ",
    });
    expect(result.owned).toBe(true);
  });

  it("グループ会社のドメインは同じ系列として認める", () => {
    expect(
      checkDomainOwnership({
        companyName: "株式会社長津製作所",
        url: "https://www.nagatsu-g.co.jp/company/about/",
        rootTitle: "長津グループ",
        rootText: "長津グループのウェブサイトです。",
      }).owned,
    ).toBe(true);

    expect(
      checkDomainOwnership({
        companyName: "アオイ自動車工業株式会社",
        url: "https://aoi-group.com/about/",
        rootTitle: "アオイグループ",
        rootText: "アオイグループは自動車整備を手がけています。",
      }).owned,
    ).toBe(true);
  });

  it("多数の企業を並べた名簿は落とす", () => {
    const listing = [
      "株式会社アルファ工業",
      "株式会社ベータ製作所",
      "有限会社ガンマ精機",
      "株式会社デルタ鉄工",
      "株式会社イプシロン機械",
      "有限会社ゼータ金属",
    ].join(" / ");
    const result = checkDomainOwnership({
      companyName: "株式会社大神鉄工所",
      url: "https://example-portal.jp/member/daisin.html",
      rootTitle: "会員企業一覧",
      rootText: listing,
    });
    expect(result.owned).toBe(false);
  });

  it("社名の核を取り出せる", () => {
    expect(companyCoreName("株式会社長津製作所")).toBe("長津");
    expect(companyCoreName("アオイ自動車工業株式会社")).toBe("アオイ");
    expect(companyCoreName("大東プレス工業株式会社")).toBe("大東プレス");
    expect(companyCoreName("大阪機器製造株式会社")).toBe("大阪機器");
    // 地名だけになる社名は識別に使えないので使わない
    expect(companyCoreName("株式会社大阪")).toBeNull();
  });
});

describe("looksLikeRecordPageUrl（名簿の1件分のページ）", () => {
  it.each([
    "https://www.monodukuri-kyoto.jp/company/4630/",
    "https://www.letswork-hyogo.jp/company/b0140/",
    "https://www.kenkocho.co.jp/asp/data/kd_cotoda/503876",
    "https://www.m-osaka.com/jp/takumi/7044/",
    "https://amaportal.jp/detail01.php?n=4644",
    "https://irbank.net/mynumber/pref/27?c=27211&z=5670047",
    "https://www.24u.jp/0664994784/",
  ])("識別子つきのページを見分ける: %s", (url) => {
    expect(looksLikeRecordPageUrl(url)).toBe(true);
  });

  it.each([
    "http://www.daito-press.co.jp/company",
    "https://www.nagatsu-g.co.jp/company/about/",
    "https://aoi-group.com/about/",
    "https://www.chiyoda-seiki.co.jp/company/foothold.html",
    // ファイル名に数字が入る自社サイトを落とさない
    "http://ohskchuck.web.fc2.com/ohashi-011.html",
    "https://kojima-ironworks.co.jp/pages/2/",
  ])("自社サイトの固定ページは識別子と見なさない: %s", (url) => {
    expect(looksLikeRecordPageUrl(url)).toBe(false);
  });
});

describe("Web検索で見つけた公式サイトが合格できる（55点天井の修正）", () => {
  const target = {
    companyName: "株式会社山本精機製作所",
    address: "大阪府大阪市東成区中本1-2-3",
    phone: null,
    corporateNumber: "1120001234567",
  };
  const page = {
    title: "株式会社山本精機製作所｜会社概要",
    pageText: "会社概要 株式会社山本精機製作所 大阪府大阪市東成区中本1-2-3 事業内容",
  };

  it("持ち主を確認できれば閾値を越える", () => {
    // 修正前は 15(出所)+20(社名)+15(所在地)+5(会社概要)=55点が天井で、
    // どれだけ正しい公式サイトでも 60点に届かなかった。
    // 残る加点（電話15・法人番号20・ドメイン名類似12）は実データでほぼ取れない。
    const r = scoreOfficialSiteCandidate(target, {
      url: "https://yamamoto-seiki.co.jp/company/",
      source: "search",
      ...page,
      domainOwnershipConfirmed: true,
    });
    expect(r.confidence).toBeGreaterThanOrEqual(OFFICIAL_SITE_THRESHOLD);
    expect(r.reasons).toContain("ドメインの持ち主が同社と確認");
  });

  it("持ち主を確認できていない（保留）なら加点しない", () => {
    // 保留に加点すると、名簿と否定できなかっただけのポータルが通ってしまう
    const r = scoreOfficialSiteCandidate(target, {
      url: "https://yamamoto-seiki.co.jp/company/",
      source: "search",
      ...page,
      domainOwnershipConfirmed: false,
    });
    expect(r.confidence).toBeLessThan(OFFICIAL_SITE_THRESHOLD);
  });

  it("所在地が一致しなければ、持ち主を確認できても通さない", () => {
    const r = scoreOfficialSiteCandidate(target, {
      url: "https://other-company.co.jp/company/",
      source: "search",
      title: "株式会社山本精機製作所｜会社概要",
      pageText: "会社概要 株式会社山本精機製作所 事業内容",
      domainOwnershipConfirmed: true,
    });
    expect(r.confidence).toBeLessThan(OFFICIAL_SITE_THRESHOLD);
  });

  it("持ち主の確認は「確認できた」と「保留」を区別する", () => {
    const confirmed = checkDomainOwnership({
      companyName: "株式会社葉田鋳造鉄工所",
      url: "https://hatataki.co.jp/company/",
      rootTitle: "株式会社葉田鋳造鉄工所",
      rootText: "ごあいさつ",
    });
    expect(confirmed).toMatchObject({ owned: true, confirmed: true });

    const held = checkDomainOwnership({
      companyName: "株式会社葉田鋳造鉄工所",
      url: "https://example.co.jp/company/",
      rootTitle: "ものづくりのプロ",
      rootText: "高精度加工でお応えします",
    });
    expect(held).toMatchObject({ owned: true, confirmed: false });
  });
});
