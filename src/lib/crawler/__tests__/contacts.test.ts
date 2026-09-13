import { describe, expect, it } from "vitest";
import { extractEmails, extractMailtoEmails, extractPhones, extractSocialLinks, looksLikeContactForm, selectCompanyEmail } from "../contacts";

describe("extractEmails", () => {
  it("extracts plain and obfuscated emails, ignoring images and placeholders", () => {
    const text = "お問い合わせ: info@sakura.co.jp / 採用: recruit [at] sakura.co.jp / logo@2x.png / sample@example.com";
    const emails = extractEmails(text);
    expect(emails).toContain("info@sakura.co.jp");
    expect(emails).toContain("recruit@sakura.co.jp");
    expect(emails.some((e) => e.endsWith(".png"))).toBe(false);
    expect(emails).not.toContain("sample@example.com");
  });
  it("returns empty array when nothing found (never guesses)", () => {
    expect(extractEmails("メールアドレスは記載していません")).toEqual([]);
  });
  it("extracts from mailto links", () => {
    expect(extractMailtoEmails([{ url: "mailto:Info@Sakura.co.jp?subject=x", text: "" }])).toEqual(["info@sakura.co.jp"]);
  });
});

describe("extractPhones", () => {
  it("extracts Japanese phone numbers", () => {
    const phones = extractPhones("TEL: 06-1234-5678 / FAX 06-1234-5679 / 〒541-0053 / 090-1234-5678");
    expect(phones).toContain("06-1234-5678");
    expect(phones).toContain("090-1234-5678");
    expect(phones.some((p) => p.replace(/\D/g, "") === "5410053")).toBe(false);
  });
});

describe("extractSocialLinks", () => {
  it("extracts official account links and ignores share links", () => {
    const s = extractSocialLinks([
      { url: "https://www.instagram.com/sakura_official/", text: "Instagram" },
      { url: "https://www.facebook.com/sharer/sharer.php?u=x", text: "share" },
      { url: "https://www.facebook.com/sakura.co.jp", text: "Facebook" },
      { url: "https://twitter.com/intent/tweet?text=x", text: "tweet" },
      { url: "https://x.com/sakura_jp", text: "X" },
      { url: "https://www.youtube.com/@sakura", text: "YouTube" },
    ]);
    expect(s.instagram_url).toBe("https://www.instagram.com/sakura_official");
    expect(s.facebook_url).toBe("https://www.facebook.com/sakura.co.jp");
    expect(s.x_url).toBe("https://x.com/sakura_jp");
    expect(s.youtube_url).toBe("https://www.youtube.com/@sakura");
    expect(s.linkedin_url).toBeNull();
  });
});

describe("selectCompanyEmail（企業の連絡先として保存してよいメールの選定）", () => {
  it("自社ドメインのメールを最優先する", () => {
    expect(selectCompanyEmail(["contact@web-agency.jp", "info@sakura.co.jp"], "sakura.co.jp")).toBe("info@sakura.co.jp");
  });

  it("サブドメインのメールも自社として扱う", () => {
    expect(selectCompanyEmail(["info@mail.sakura.co.jp"], "sakura.co.jp")).toBe("info@mail.sakura.co.jp");
  });

  it("自社ドメインが無ければフリーメールを採用する（中小企業で一般的）", () => {
    expect(selectCompanyEmail(["sakura.seisakusho@gmail.com"], "sakura.co.jp")).toBe("sakura.seisakusho@gmail.com");
    expect(selectCompanyEmail(["info@yahoo.co.jp"], "sakura.co.jp")).toBe("info@yahoo.co.jp");
  });

  it("制作会社など無関係ドメインのメールは企業の連絡先にしない", () => {
    expect(selectCompanyEmail(["contact@web-seisaku-agency.jp"], "sakura.co.jp")).toBeNull();
    expect(selectCompanyEmail(["support@cms-vendor.com", "sales@printing.co.jp"], "sakura.co.jp")).toBeNull();
  });

  it("メールが1件も無ければ null（推測生成しない）", () => {
    expect(selectCompanyEmail([], "sakura.co.jp")).toBeNull();
    expect(selectCompanyEmail([], null)).toBeNull();
  });

  it("ドメイン不明でもフリーメールなら採用、それ以外は不採用", () => {
    expect(selectCompanyEmail(["shop@gmail.com"], null)).toBe("shop@gmail.com");
    expect(selectCompanyEmail(["info@unknown-vendor.jp"], null)).toBeNull();
  });
});

describe("問い合わせフォームの判定", () => {
  const inquiryText = "お問い合わせはこちらのフォームからお願いいたします。";

  it("本文欄のある問い合わせフォームを認める", () => {
    expect(looksLikeContactForm("https://example.co.jp/contact/", true, inquiryText, { hasTextarea: true, formFieldCount: 6 })).toBe(true);
  });

  it("URLが問い合わせページを示していれば、最小限のフォームでも認める", () => {
    // 実在サイトには入力欄が1つだけの問い合わせフォームもある
    expect(looksLikeContactForm("https://example.co.jp/a/inquiry.php", true, inquiryText, { hasTextarea: false, formFieldCount: 1 })).toBe(true);
  });

  it("本文の言葉だけが根拠のときは、検索ボックスを問い合わせフォームにしない", () => {
    // 会社概要ページの検索ボックス。hasForm だけでは区別できない
    expect(looksLikeContactForm("https://example.co.jp/company/outline.html", true, inquiryText, { hasTextarea: false, formFieldCount: 1 })).toBe(false);
  });

  it("特定商取引法に基づく表記のページを除外する", () => {
    // 実データ: https://mizuwajc.co.jp/shop/ownerInformation.html を
    // 問い合わせフォームとして登録していた
    expect(
      looksLikeContactForm("https://mizuwajc.co.jp/shop/ownerInformation.html", true, "特定商取引法に基づく表記 お問い合わせ先", {
        hasTextarea: true,
        formFieldCount: 5,
      }),
    ).toBe(false);
  });

  it("プライバシーポリシー・利用規約のページを除外する", () => {
    for (const url of ["https://example.co.jp/privacy/", "https://example.co.jp/kiyaku.html", "https://example.co.jp/terms"]) {
      expect(looksLikeContactForm(url, true, inquiryText, { hasTextarea: true, formFieldCount: 5 }), url).toBe(false);
    }
  });

  it("本文の言葉が根拠でも、入力欄が3つ以上あれば認める", () => {
    expect(looksLikeContactForm("https://example.co.jp/support.html", true, inquiryText, { hasTextarea: false, formFieldCount: 4 })).toBe(true);
  });

  it("入力欄の情報が無い場合は従来どおり判定する（旧データとの互換）", () => {
    expect(looksLikeContactForm("https://example.co.jp/contact/", true, inquiryText)).toBe(true);
  });
});
