/**
 * 実データ検証（大阪府/製造業/20社）で判明した誤判定を固定する。
 * 実際に Web検索 が返したタイトルと、GビズINFO が返した法人名をそのまま使う。
 */
import { describe, expect, it } from "vitest";
import { cleanCompanyName, isPlausibleCompany, toCandidate } from "../normalizer";
import { isPublicEntity, matchesConditions } from "@/lib/integrations/gbiz/mapping";
import { isNonOfficialDomain } from "@/lib/companies/official-site";
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
