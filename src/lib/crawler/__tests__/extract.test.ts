import { describe, expect, it } from "vitest";
import { classifyPage, isCrawlableUrl, isSameSite } from "../classify";
import { extractHtml } from "../extract";
import { canonicalKey, crawlSite } from "../crawl-site";

describe("extractHtml", () => {
  it("extracts title, text, links and form flag; drops scripts", () => {
    const html = `<html><head><title>会社概要 | テスト</title><meta name="description" content="説明文"></head>
      <body><script>var x=1;</script><nav><a href="/recruit/">採用情報</a></nav>
      <main><h1>会社概要</h1><p>所在地 大阪府</p><form><input></form></main></body></html>`;
    const r = extractHtml(html, "https://example.jp/company/", 1000);
    expect(r.title).toBe("会社概要 | テスト");
    expect(r.text).toContain("説明文");
    expect(r.text).toContain("所在地 大阪府");
    expect(r.text).not.toContain("var x");
    expect(r.links[0]).toEqual({ url: "https://example.jp/recruit/", text: "採用情報" });
    expect(r.hasForm).toBe(true);
  });
  it("truncates to max chars", () => {
    const r = extractHtml(`<p>${"あ".repeat(500)}</p>`, "https://example.jp", 100);
    expect(r.text.length).toBe(100);
  });
});

describe("classifyPage", () => {
  it("classifies by url and link text", () => {
    expect(classifyPage("https://example.jp/", null, null, "https://example.jp").type).toBe("top");
    expect(classifyPage("https://example.jp/company/", "会社概要", null, "https://example.jp").type).toBe("company");
    expect(classifyPage("https://example.jp/recruit/", "採用情報", null, "https://example.jp").type).toBe("recruit");
    expect(classifyPage("https://example.jp/recruit/newgrad/", "新卒採用", null, "https://example.jp").type).toBe("recruit_new_graduate");
    expect(classifyPage("https://example.jp/contact/", "お問い合わせ", null, "https://example.jp").type).toBe("contact");
    expect(classifyPage("https://example.jp/xyz/", "リンク", null, "https://example.jp").type).toBe("other");
  });
  it("filters non-crawlable urls and other sites", () => {
    expect(isCrawlableUrl("https://example.jp/a.pdf")).toBe(false);
    expect(isCrawlableUrl("https://example.jp/wp-admin/")).toBe(false);
    expect(isCrawlableUrl("https://example.jp/company/")).toBe(true);
    expect(isSameSite("https://www.example.jp/a", "https://example.jp")).toBe(true);
    expect(isSameSite("https://other.jp/a", "https://example.jp")).toBe(false);
  });
  it("canonical key ignores trailing slash and index.html", () => {
    expect(canonicalKey("https://www.example.jp/company/index.html")).toBe(canonicalKey("https://example.jp/company"));
  });
});

describe("crawlSite (mock site)", () => {
  it("crawls a mock site respecting max pages and extracts contacts", async () => {
    const summary = await crawlSite("https://mock-sakura-seisakusho-7.example.jp", { maxPages: 8, delayMs: 0 });
    expect(summary.robotsBlocked).toBe(false);
    expect(summary.pages.length).toBeGreaterThan(1);
    expect(summary.pages.length).toBeLessThanOrEqual(8);
    expect(summary.pages[0].pageType).toBe("top");
    const types = summary.pages.map((p) => p.pageType);
    expect(types).toContain("company");
    expect(types).toContain("contact");
    expect(summary.phones.length).toBeGreaterThan(0);
    expect(summary.contactPageUrl).toMatch(/\/contact/);
    // 同一 URL を二度取得しない
    const keys = summary.pages.map((p) => canonicalKey(p.url));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
