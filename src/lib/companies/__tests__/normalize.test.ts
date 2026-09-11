import { describe, expect, it } from "vitest";
import { addressAppearsIn, addressMatchKeys, extractCity, extractDomain, extractPrefecture, normalizeAddress, normalizeCompanyName, normalizeCorporateNumber, normalizePhone, normalizeUrl, parseEmployeeCount } from "../normalize";

describe("normalizeUrl", () => {
  it("adds https scheme and lowercases host", () => {
    expect(normalizeUrl("Example.CO.JP")).toBe("https://example.co.jp");
  });
  it("removes trailing slash on root, fragment and tracking params", () => {
    expect(normalizeUrl("https://example.jp/?utm_source=x#top")).toBe("https://example.jp");
    expect(normalizeUrl("https://example.jp/company/?ref=1&utm_medium=y")).toBe("https://example.jp/company/?ref=1");
  });
  it("returns null for invalid or non-http", () => {
    expect(normalizeUrl("mailto:info@example.jp")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });
});

describe("extractDomain", () => {
  it("strips www and port", () => {
    expect(extractDomain("http://www.Example.co.jp:8080/about")).toBe("example.co.jp");
    expect(extractDomain("example.jp")).toBe("example.jp");
  });
  it("returns null for invalid", () => {
    expect(extractDomain(null)).toBeNull();
  });
});

describe("normalizeCompanyName", () => {
  it("removes corporate suffix, spaces, symbols and lowercases", () => {
    expect(normalizeCompanyName("株式会社 ＡＢＣ製作所")).toBe("abc製作所");
    expect(normalizeCompanyName("ABC製作所 株式会社")).toBe("abc製作所");
    expect(normalizeCompanyName("（株）ABC・製作所")).toBe("abc製作所");
    expect(normalizeCompanyName("ABC Co., Ltd.")).toBe("abc");
  });
  it("treats different suffix placements as the same", () => {
    expect(normalizeCompanyName("株式会社サンプル")).toBe(normalizeCompanyName("サンプル株式会社"));
  });
});

describe("normalizeAddress", () => {
  it("normalizes width, chome and banchi", () => {
    expect(normalizeAddress("大阪府大阪市中央区本町１丁目２番３号")).toBe("大阪府大阪市中央区本町1-2-3");
    expect(normalizeAddress("大阪府大阪市中央区本町1-2-3")).toBe("大阪府大阪市中央区本町1-2-3");
    expect(normalizeAddress("〒541-0053 大阪府大阪市中央区本町一丁目2-3 ")).toBe("大阪府大阪市中央区本町1-2-3");
  });
  it("returns null for empty", () => {
    expect(normalizeAddress(null)).toBeNull();
  });
});

describe("extractPrefecture / extractCity", () => {
  it("extracts prefecture and city", () => {
    expect(extractPrefecture("大阪府東大阪市高井田1-1")).toBe("大阪府");
    expect(extractCity("大阪府東大阪市高井田1-1")).toBe("東大阪市");
    expect(extractCity("大阪府大阪市中央区本町1-1")).toBe("大阪市中央区");
    expect(extractCity("北海道河東郡音更町木野1")).toBe("河東郡音更町");
  });
});

describe("normalizePhone / corporate number / employee count", () => {
  it("normalizes phone", () => {
    expect(normalizePhone("０６−１２３４−５６７８")).toBe("06-1234-5678");
    expect(normalizePhone("0612345678")).toBe("0612345678");
    expect(normalizePhone("123")).toBeNull();
  });
  it("validates corporate number", () => {
    expect(normalizeCorporateNumber("1234567890123")).toBe("1234567890123");
    expect(normalizeCorporateNumber(1234567890123)).toBe("1234567890123");
    expect(normalizeCorporateNumber("12345")).toBeNull();
  });
  it("parses employee count", () => {
    expect(parseEmployeeCount("１２０名")).toBe(120);
    expect(parseEmployeeCount("1,200")).toBe(1200);
    expect(parseEmployeeCount(null)).toBeNull();
    expect(parseEmployeeCount(0)).toBeNull();
  });
});

describe("所在地の照合（addressAppearsIn）", () => {
  // GビズINFO は県名から書き、企業サイトは省くことが多い。
  // 完全一致を求めると実在の企業が確認済みに上がらず、営業リストに乗らない。
  const gbiz = "大阪府東大阪市長田中1丁目2番3号";

  it("県名まで含めて一致する", () => {
    expect(addressAppearsIn(gbiz, "所在地 大阪府東大阪市長田中1-2-3")).toBe(true);
  });

  it("県名を省いたサイト表記でも一致する", () => {
    expect(addressAppearsIn(gbiz, "〒577-0013 東大阪市長田中1-2-3 TEL 06-0000-0000")).toBe(true);
  });

  it("丁目・番地の表記ゆれを吸収する", () => {
    expect(addressAppearsIn(gbiz, "東大阪市長田中一丁目2番3号")).toBe(true);
  });

  it("別の市の住所とは一致しない", () => {
    expect(addressAppearsIn(gbiz, "大阪府八尾市太子堂1-2-3")).toBe(false);
  });

  it("同じ市でも町名が違えば一致しない", () => {
    expect(addressAppearsIn(gbiz, "大阪府東大阪市荒本北1-2-3")).toBe(false);
  });

  it("住所もテキストも無ければ一致しない", () => {
    expect(addressAppearsIn(null, "大阪府東大阪市長田中1-2-3")).toBe(false);
    expect(addressAppearsIn(gbiz, null)).toBe(false);
  });

  it("市名だけの短いキーでは一致させない（誤一致の防止）", () => {
    // 「大阪市」のみの住所は 6 文字未満のキーしか作れないため照合に使わない
    expect(addressMatchKeys("大阪府大阪市").every((k) => k.length >= 6)).toBe(true);
  });
});
