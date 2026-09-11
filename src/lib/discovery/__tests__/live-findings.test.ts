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

describe("50社検証で残った見出しノイズ", () => {
  const rejected = [
    // 業種・工程・製品の一般名詞だけ
    "電気機器",
    "切削加工品",
    "強み",
    "精密加工",
    "表面処理",
    // 業界団体・協同組合
    "大阪化学工業薬品協会INDEX",
    "大阪府電気工事工業組合",
    "大阪商工会議所",
    // 記事タイトル
    "電力会社・電気料金プランランキング",
    "金属加工工場おすすめ10選",
    // 語が並んだ見出し
    "実像~ 大阪ブランドコミッティ 家電パネル",
  ];
  for (const name of rejected) {
    it(`除外する: ${name}`, () => {
      expect(isPlausibleCompany(candidate(cleanCompanyName(name)))).toBe(false);
    });
  }

  it("法人格の無い実企業名は通す", () => {
    // 一般名詞を含んでいても、固有名詞が付いていれば企業として扱う
    for (const name of ["高千穂精機", "旭化学工業", "浪速樹脂工業", "眞木鉄工所", "木村精機", "日高製作所", "タツタ電線"]) {
      expect(isPlausibleCompany(candidate(name))).toBe(true);
    }
  });

  it("英語表記の社名を語数で落とさない", () => {
    expect(isPlausibleCompany(candidate("Naniwa Precision Works"))).toBe(true);
  });
});

describe("兵庫県の検証で出た見出しノイズ", () => {
  const rejected = [
    // 業界団体（組合・協会）
    "兵庫県電機商業組合",
    "兵庫県自動車部品商組合",
    // 一般名詞だけ
    "電力会社",
    "製造会社",
    "マーケット",
    // 記事タイトル
    "電力会社:電気&電気ガスセットおすすめランキング",
    "でんきのこと",
    "会社案内",
  ];
  for (const name of rejected) {
    it(`除外する: ${name}`, () => {
      expect(isPlausibleCompany(candidate(cleanCompanyName(name)))).toBe(false);
    });
  }

  it("鉤括弧と末尾の「へ」を落とす", () => {
    expect(cleanCompanyName("「光電気工業」へ")).toBe("光電気工業");
    expect(cleanCompanyName("栗本加工へ")).toBe("栗本加工");
  });

  it("末尾の記号・絵文字を落とす", () => {
    expect(cleanCompanyName("株式会社巴商会-")).toBe("株式会社巴商会");
  });

  it("兵庫県で実在した企業は通す", () => {
    for (const name of ["兵庫小川製作所", "東正工業", "大日製作所", "誠金属工業", "浜野鉄工", "大伸ダイス工業", "明石機械工業", "東洋電気工事", "光電気工業", "巴商会", "兵庫商会", "豊岡部品センター"]) {
      expect(isPlausibleCompany(candidate(cleanCompanyName(name)))).toBe(true);
    }
  });
});

describe("京都府の検証で出た見出しノイズ", () => {
  const rejected = [
    // 法人格が付いていても、中身が一般名詞だけなら企業名ではない
    "株式会社会社情報",
    "株式会社本社工場",
    "株式会社-プラスチック樹脂・アルミ切削加工",
    // 一般名詞のみ
    "自動車部品",
    "上場企業",
    "家電量販店",
    // ページ見出し
    "京都研究所概要・アクセスマップ",
  ];
  for (const name of rejected) {
    it(`除外する: ${name}`, () => {
      expect(isPlausibleCompany(candidate(cleanCompanyName(name)))).toBe(false);
    });
  }

  it("京都府で実在した企業は通す", () => {
    for (const name of [
      "株式会社水江鉄工",
      "株式会社宇治精機",
      "カイトウ精機株式会社",
      "株式会社瑞晃仏具製作所",
      "株式会社若林佛具製作所",
      "株式会社大黒商会",
      "株式会社大同商会",
      "京都電機器株式会社",
      "京都樹脂株式会社",
      "株式会社ベルクシーエース",
      "株式会社ナンゴ",
      "株式会社筒井",
      "株式会社常盤",
      "大京チェーン本店",
    ]) {
      expect(isPlausibleCompany(candidate(cleanCompanyName(name)))).toBe(true);
    }
  });

  it("地名が前に付いた実企業名は残す", () => {
    expect(isPlausibleCompany(candidate(cleanCompanyName("京都 前川工業化学株式会社")))).toBe(true);
  });
});
