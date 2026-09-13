import { describe, expect, it } from "vitest";
import { checkContactForm, isSameSite } from "../target";

describe("送ってよいフォームかの判定", () => {
  it("実データで誤って開いた3件を止める", () => {
    // 企業ディレクトリのクチコミ投稿フォームに取材依頼文を入力してしまった事例
    const cases = [
      { name: "なび京都", websiteUrl: null, contactFormUrl: "https://navikyo.com/075-502-5693/" },
      { name: "ツクリンク", websiteUrl: null, contactFormUrl: "https://tsukulink.net/contacts" },
      { name: "法人情報DB", websiteUrl: null, contactFormUrl: "https://houjin.goo.to/corporations/categories/retail/s-x" },
    ];
    for (const c of cases) {
      const result = checkContactForm({ websiteUrl: c.websiteUrl, verificationStatus: "needs_review", contactFormUrl: c.contactFormUrl });
      expect(result.ok, c.name).toBe(false);
    }
  });

  it("公式サイトが残っていても、別ドメインのフォームは止める", () => {
    // 除外リストに無いドメインで、同一ドメイン規則そのものを確かめる
    const result = checkContactForm({
      websiteUrl: "https://honda-seiki.co.jp",
      verificationStatus: "verified",
      contactFormUrl: "https://some-local-portal.example/contact/honda",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("別のドメイン");
  });

  it("自社ドメインのフォームは通す", () => {
    const result = checkContactForm({
      websiteUrl: "https://hatataki.co.jp",
      verificationStatus: "verified",
      contactFormUrl: "https://hatataki.co.jp/contact/",
    });
    expect(result.ok).toBe(true);
  });

  it("サブドメインのフォームも自社として扱う", () => {
    expect(
      checkContactForm({
        websiteUrl: "https://example.co.jp",
        verificationStatus: "verified",
        contactFormUrl: "https://form.example.co.jp/inquiry",
      }).ok,
    ).toBe(true);
  });

  it("公式サイトが未確認なら送らない", () => {
    const result = checkContactForm({
      websiteUrl: "https://example.co.jp",
      verificationStatus: "needs_review",
      contactFormUrl: "https://example.co.jp/contact/",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("未確認");
  });

  it("同一サイトの判定", () => {
    expect(isSameSite("example.co.jp", "example.co.jp")).toBe(true);
    expect(isSameSite("form.example.co.jp", "example.co.jp")).toBe(true);
    expect(isSameSite("example.co.jp", "example.com")).toBe(false);
    expect(isSameSite("navikyo.com", "honda-seiki.co.jp")).toBe(false);
  });
});
