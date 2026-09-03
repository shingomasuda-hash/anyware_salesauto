import { describe, expect, it } from "vitest";
import { decideSalesContactAllowed, detectSalesRestriction } from "../sales-restriction";

describe("detectSalesRestriction", () => {
  it.each([
    "営業メールはお断りしております。",
    "営業目的のお問い合わせはご遠慮ください。",
    "セールス目的のご連絡は固くお断りいたします。",
    "営業電話は禁止です。",
    "売り込みのご連絡はお受けしておりません。",
    "営業目的でのフォーム利用は禁止しています。",
    "※当フォームを営業・勧誘目的でご利用いただくことはご遠慮ください。",
    "広告や求人媒体の営業のご案内はお断りしています。",
  ])("detects: %s", (text) => {
    const hits = detectSalesRestriction(`会社概要\n${text}\nありがとうございます。`, "https://example.jp/contact");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sourceUrl).toBe("https://example.jp/contact");
    expect(hits[0].text).toContain(text.replace(/^※/, "").slice(0, 6));
  });

  it("does not flag unrelated text", () => {
    expect(detectSalesRestriction("営業時間は9:00〜18:00です。営業所は大阪にあります。", "u")).toEqual([]);
    expect(detectSalesRestriction("営業部の採用を強化しています。", "u")).toEqual([]);
  });

  it("decides sales_contact_allowed", () => {
    const hits = detectSalesRestriction("営業目的のお問い合わせはお断りします。", "u");
    expect(decideSalesContactAllowed(hits)).toBe("false");
    expect(decideSalesContactAllowed([])).toBe("unknown");
  });
});
