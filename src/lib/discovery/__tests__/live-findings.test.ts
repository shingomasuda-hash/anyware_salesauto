/**
 * 実データ検証（大阪府/製造業/20社）で判明した誤判定を固定する。
 * 実際に Web検索 が返したタイトルと、GビズINFO が返した法人名をそのまま使う。
 */
import { describe, expect, it } from "vitest";
import { cleanCompanyName, isPlausibleCompany, toCandidate } from "../normalizer";
import { isPublicEntity, matchesConditions } from "@/lib/integrations/gbiz/mapping";
import { isNonHtmlUrl, isNonOfficialDomain, looksLikeCorporateDatabaseUrl } from "@/lib/companies/official-site";
import type { GbizHojin } from "@/lib/integrations/gbiz/types";

function candidate(name: string) {
  return toCandidate({ name, source: "web_search", sourceConfidence: 30 });
}

describe("検索結果タイトルからの社名抽出", () => {
  it("文中に埋め込まれた社名を取り出す", () => {
    expect(cleanCompanyName("大阪府豊中市にある金属切削加工の株式会社トーシン")).toBe("株式会社トーシン");
    expect(cleanCompanyName("金属加工・切削加工|大阪|大一精工株式会社")).toBe("大一精工株式会社");
    expect(cleanCompanyName("大阪市で鉄、ステンレスなどの金属加工をお探しなら株式会社 ...")).toContain("株式会社");
  });

  it("従来どおり区切り前の社名も取れる", () => {
    expect(cleanCompanyName("株式会社山田製作所 | 大阪の金属加工")).toBe("株式会社山田製作所");
    expect(cleanCompanyName("株式会社キムラテック")).toBe("株式会社キムラテック");
  });
});

describe("一覧ページ・記事タイトルを企業として扱わない", () => {
  const rejected = [
    "大阪府の金属加工の会社104社【2026年】",
    "地域で検索",
    "大阪府の企業・メーカー一覧",
    "大阪で個人が金属加工を依頼できる工場 [3社]",
    "大阪府の金属加工業者",
    "大阪府の工場・製造業の一覧|シゴトアルワ",
    "金属加工 大阪<アルミ加工・SUS加工>",
  ];
  for (const title of rejected) {
    it(`除外する: ${title}`, () => {
      expect(isPlausibleCompany(candidate(cleanCompanyName(title)))).toBe(false);
    });
  }

  it("法人格を含む実企業は通す", () => {
    for (const title of ["株式会社キムラテック", "大阪府豊中市にある金属切削加工の株式会社トーシン", "金属加工・切削加工|大阪|大一精工株式会社"]) {
      expect(isPlausibleCompany(candidate(cleanCompanyName(title)))).toBe(true);
    }
  });
});

describe("GビズINFO の公的機関を除外する", () => {
  const publicEntities = [
    "大阪市今福町財産区",
    "大阪市十三東之町財産区",
    "大阪市鞍作新家町財産区",
    "大阪市南大道町財産区",
    "大阪市岡之町財産区",
    "大阪市両国町財産区",
    "大阪第二検察審査会",
    "大阪高等裁判所",
  ];
  for (const name of publicEntities) {
    it(`除外する: ${name}`, () => {
      expect(isPublicEntity(name)).toBe(true);
      const hojin = { name, location: "大阪府大阪市" } as GbizHojin;
      expect(matchesConditions(hojin, { prefecture: "大阪府", industry: "manufacturing", requestedCount: 20 }).ok).toBe(false);
    });
  }

  it("実在の事業会社は除外しない", () => {
    for (const name of ["株式会社キムラテック", "大一精工株式会社", "山田製作所"]) {
      expect(isPublicEntity(name)).toBe(false);
      const hojin = { name, location: "大阪府大阪市" } as GbizHojin;
      expect(matchesConditions(hojin, { prefecture: "大阪府", industry: "manufacturing", requestedCount: 20 }).ok).toBe(true);
    }
  });
});

describe("ディレクトリ・自治体サイトを公式サイト候補にしない", () => {
  const blocked = [
    "metoree.com", "www.aperza.com", "bconnect.jp", "www.hakenlist.com",
    "mitsu-ri.net", "proteg.jp", "monodzukuri.com", "kinzoku-kakou.net",
    "city.osaka.lg.jp", "pref.osaka.lg.jp",
  ];
  for (const domain of blocked) {
    it(`除外する: ${domain}`, () => expect(isNonOfficialDomain(domain)).toBe(true));
  }

  it("実企業のドメインは通す", () => {
    for (const d of ["www.kimuratec.jp", "toshin-metal.co.jp", "dai1sei.co.jp", "sus-shinshin.co.jp"]) {
      expect(isNonOfficialDomain(d)).toBe(false);
    }
  });
});

describe("社名を途中で切らない", () => {
  it("スペースを含む社名を保持する", () => {
    expect(cleanCompanyName("Naniwa Kogyo 34株式会社")).toBe("Naniwa Kogyo 34株式会社");
    expect(cleanCompanyName("大阪 精密機器株式会社")).toBe("大阪 精密機器株式会社");
  });

  it("法人格の直後が助詞・語尾なら社名として拾わない", () => {
    expect(cleanCompanyName("大阪の金属加工なら山田製作所株式会社です")).toContain("山田製作所株式会社");
    expect(cleanCompanyName("大阪の金属加工なら山田製作所株式会社です")).not.toBe("株式会社です");
  });
});

describe("2回目の実データ検証で判明した社名の誤抽出", () => {
  it("社名の前に付く説明句を落とす", () => {
    expect(cleanCompanyName("大阪の加工業ならイトウ精工株式会社")).toBe("イトウ精工株式会社");
    expect(cleanCompanyName("アルミ加工・精密加工・微細加工の中田製作所")).toBe("中田製作所");
    expect(cleanCompanyName("金属から樹脂まで高精度精密機械加工技術の河内金属製作所")).toBe("河内金属製作所");
  });

  it("法人格の直前が助詞で終わるものは企業名として扱わない", () => {
    const n = cleanCompanyName("ステンレスなどの金属加工をお探しなら株式会社");
    expect(isPlausibleCompany(candidate(n))).toBe(false);
  });

  it("短い社名に「の」が含まれていても壊さない", () => {
    expect(cleanCompanyName("たけのこ製作所")).toBe("たけのこ製作所");
    expect(cleanCompanyName("株式会社きのこ")).toBe("株式会社きのこ");
  });
});

describe("3回目の実データ検証で判明した公式サイトの誤マッチ", () => {
  it("法人情報データベース・地域ポータルを公式サイト候補にしない", () => {
    // 社名が必ずページ内に現れるため、除外しないと「社名一致」で加点され誤採用される
    const blocked = [
      "www.houjinbase.com", "houjin.goo.to", "fumadata.com", "j-lic.com",
      "www.mono-web.jp", "www.yao-mono.jp", "corporate-number.com", "www.nta.go.jp",
    ];
    for (const d of blocked) expect([d, isNonOfficialDomain(d)]).toEqual([d, true]);
  });

  it("実企業のドメインは引き続き通す", () => {
    for (const d of ["www.asahi-chem.co.jp", "kinoshita-kogyo.co.jp", "hamadakagu.jp", "nakata-ss.co.jp"]) {
      expect([d, isNonOfficialDomain(d)]).toEqual([d, false]);
    }
  });
});

describe("50社検証で判明した公式サイト候補のノイズ", () => {
  it("ディレクトリ・地図・プレスリリースサイトを除外する", () => {
    const blocked = [
      "townpage.goo.ne.jp", "map.goo.ne.jp", "buzip.net", "el.e-shops.jp",
      "www.bigcompany.jp", "machi.jpubb.com", "www.i-o-m.jp", "bso16241.bsj.jp",
    ];
    for (const d of blocked) expect([d, isNonOfficialDomain(d)]).toEqual([d, true]);
  });

  it("PDF・表計算などHTML以外は公式サイト候補にしない", () => {
    const files = [
      "https://www.np.nipro-pharma.co.jp/pdf/nipropharma_corporate_profile.pdf",
      "https://www.jtccm.or.jp/sites/default/files/JIS/ISO_list_0.xlsx",
      "https://example.co.jp/catalog.docx",
      "https://example.co.jp/logo.png",
    ];
    for (const u of files) expect([u, isNonHtmlUrl(u)]).toEqual([u, true]);
    for (const u of ["https://example.co.jp/", "https://example.co.jp/company/outline.html"]) {
      expect([u, isNonHtmlUrl(u)]).toEqual([u, false]);
    }
  });

  it("法人番号をパスに含むURLは法人情報データベースとみなす", () => {
    expect(looksLikeCorporateDatabaseUrl("https://xn--zcklx7evic7044c1qeqrozh7c.com/companies/1120001021305")).toBe(true);
    expect(looksLikeCorporateDatabaseUrl("https://houjin.example.com/1234567890123/")).toBe(true);
    expect(looksLikeCorporateDatabaseUrl("https://yamada-ss.co.jp/company/")).toBe(false);
  });
});
