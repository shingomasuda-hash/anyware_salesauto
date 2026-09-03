import { describe, expect, it } from "vitest";
import { extractEmails, extractMailtoEmails, extractPhones, extractSocialLinks } from "../contacts";

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
