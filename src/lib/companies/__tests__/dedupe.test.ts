import { describe, expect, it } from "vitest";
import { matchDuplicate, type DedupeExisting } from "../dedupe";
import { normalizeAddress, normalizeCompanyName } from "../normalize";

const existing: DedupeExisting[] = [
  { id: "a", corporate_number: "1111111111111", website_domain: "a-corp.co.jp", company_name_normalized: normalizeCompanyName("株式会社エーコープ"), address_normalized: normalizeAddress("大阪府大阪市中央区本町1-2-3") },
  { id: "b", corporate_number: null, website_domain: "b-inc.jp", company_name_normalized: normalizeCompanyName("ビー株式会社"), address_normalized: normalizeAddress("東京都千代田区丸の内1-1-1") },
  { id: "c", corporate_number: null, website_domain: null, company_name_normalized: normalizeCompanyName("シー製作所"), address_normalized: normalizeAddress("愛知県名古屋市中区栄3-4-5") },
];

describe("matchDuplicate", () => {
  it("matches by corporate number first", () => {
    const m = matchDuplicate({ corporateNumber: "1111111111111", companyName: "全く別の名前", websiteDomain: "other.jp" }, existing);
    expect(m).toEqual({ id: "a", reason: "corporate_number" });
  });
  it("matches by website domain when no corporate number", () => {
    const m = matchDuplicate({ companyName: "別名", websiteDomain: "b-inc.jp" }, existing);
    expect(m).toEqual({ id: "b", reason: "website_domain" });
  });
  it("matches by normalized name + address", () => {
    const m = matchDuplicate({ companyName: "株式会社シー製作所", address: "愛知県名古屋市中区栄３丁目４番５号" }, existing);
    expect(m).toEqual({ id: "c", reason: "name_address" });
  });
  it("does not match same name with different address", () => {
    const m = matchDuplicate({ companyName: "シー製作所", address: "大阪府大阪市北区梅田1-1" }, existing);
    expect(m).toBeNull();
  });
  it("does not match on name alone without address", () => {
    expect(matchDuplicate({ companyName: "シー製作所" }, existing)).toBeNull();
  });
  it("prefers corporate number over domain when both present", () => {
    const m = matchDuplicate({ corporateNumber: "1111111111111", companyName: "x", websiteDomain: "b-inc.jp" }, existing);
    expect(m?.id).toBe("a");
  });
});

describe("既存企業への識別情報の書き戻し", () => {
  // 名前+所在地で一致した既存企業に法人番号が無いまま放置すると、
  // 次に同じ企業を GビズINFO で見つけても法人番号で重複と判定できず、
  // 毎回「新しい企業」として検証・クロールをやり直すことになる。
  it("法人番号が無い既存企業は、法人番号での重複判定に引っかからない", () => {
    const existing = [
      { id: "c1", corporate_number: null, website_domain: null, company_name_normalized: "杉岡鉄工所", address_normalized: "大阪府東大阪市長田中2-4-8" },
    ];
    expect(matchDuplicate({ corporateNumber: "9876543210987", companyName: "株式会社杉岡鉄工所" }, existing)).toBeNull();
  });

  it("法人番号が入っていれば、所在地の表記が違っても重複と判定できる", () => {
    const existing = [
      { id: "c1", corporate_number: "9876543210987", website_domain: null, company_name_normalized: "杉岡鉄工所", address_normalized: "大阪府東大阪市長田中2-4-8" },
    ];
    const hit = matchDuplicate({ corporateNumber: "9876543210987", companyName: "杉岡鉄工所（本社）", address: "東大阪市長田中2丁目4番8号" }, existing);
    expect(hit).toEqual({ id: "c1", reason: "corporate_number" });
  });
});
