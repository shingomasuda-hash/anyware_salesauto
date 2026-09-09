/**
 * 実企業サイトに近い HTML をローカル HTTP サーバーで配信し、
 * 本番と同じクローラー（crawlSite）で取得できるかを検証する。
 * モックサイト（*.example.jp）では現れない実データ特性を対象にする:
 *   Shift_JIS / テーブルレイアウト / 難読化メール / 制作会社メール混入 /
 *   JS レンダリングで本文が空の問い合わせページ / 拡張子付き URL / meta refresh
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import iconv from "iconv-lite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlSite } from "../crawl-site";
import { detectSalesRestriction } from "../sales-restriction";

type Page = { html: string; charset?: "utf-8" | "shift_jis"; contentType?: string; status?: number };
const sites: Record<string, Record<string, Page>> = {};

// --- サイトA: 旧来のテーブルレイアウト + Shift_JIS + 営業お断り + 難読化メール ---
sites["/a"] = {
  "/a/": {
    charset: "shift_jis",
    html: `<html><head><title>株式会社大阪精密工業</title></head><body>
      <table><tr><td><a href="/a/company.html">会社概要</a></td>
      <td><a href="/a/recruit/index.html">採用情報</a></td>
      <td><a href="/a/inquiry.php">お問い合わせ</a></td></tr></table>
      <table><tr><td>金属部品の精密加工を行っております。</td></tr></table>
      <p>TEL：０６－６１２３－４５６７</p></body></html>`,
  },
  "/a/company.html": {
    charset: "shift_jis",
    html: `<html><head><title>会社概要｜株式会社大阪精密工業</title></head><body>
      <table>
      <tr><th>会社名</th><td>株式会社大阪精密工業</td></tr>
      <tr><th>所在地</th><td>〒５４１－００５３　大阪府大阪市中央区本町１丁目２番３号</td></tr>
      <tr><th>従業員数</th><td>８５名</td></tr>
      <tr><th>電話番号</th><td>06-6123-4567</td></tr>
      </table></body></html>`,
  },
  "/a/recruit/index.html": {
    charset: "shift_jis",
    html: `<html><head><title>採用情報</title></head><body><h1>採用情報</h1>
      <p>中途採用：機械オペレーター（正社員）を募集しています。</p></body></html>`,
  },
  "/a/inquiry.php": {
    charset: "shift_jis",
    html: `<html><head><title>お問い合わせ</title></head><body><h1>お問い合わせ</h1>
      <p>メールは info(at)osaka-seimitsu.co.jp までお願いします。</p>
      <p>※営業目的でのお問い合わせは固くお断りいたします。</p>
      <form action="/a/send.php" method="post"><input name="name"><button>送信</button></form>
      </body></html>`,
  },
};

// --- サイトB: モダン + SNS + 新卒/中途 + フッターに制作会社の別ドメインメール ---
sites["/b"] = {
  "/b/": {
    html: `<html><head><title>ヤマト工業株式会社</title></head><body>
      <nav><a href="/b/about/">会社案内</a><a href="/b/saiyo/">採用情報</a>
      <a href="/b/contact/">お問い合わせ</a></nav>
      <main><p>DX推進により生産管理システムを自社開発しています。</p></main>
      <footer>
        <a href="https://www.instagram.com/yamato_kogyo/">Instagram</a>
        <a href="https://twitter.com/intent/tweet?text=share">シェア</a>
        <a href="https://x.com/yamato_kogyo">X</a>
        <p>Web制作：<a href="mailto:contact@web-seisaku-agency.jp">株式会社Web制作エージェンシー</a></p>
      </footer></body></html>`,
  },
  "/b/about/": { html: `<html><head><title>会社案内</title></head><body><h1>会社案内</h1><p>創業1965年。</p></body></html>` },
  "/b/saiyo/": {
    html: `<html><head><title>採用情報</title></head><body><h1>採用情報</h1>
      <p>2027年卒 新卒採用エントリー受付中。中途採用も通年で実施しています。</p>
      <a href="/b/saiyo/interview/">社員インタビュー</a></body></html>`,
  },
  "/b/saiyo/interview/": { html: `<html><head><title>社員インタビュー</title></head><body><p>入社3年目の先輩に聞きました。</p></body></html>` },
  "/b/contact/": {
    html: `<html><head><title>お問い合わせ</title></head><body><h1>お問い合わせ</h1>
      <p>お問い合わせは <a href="mailto:info@yamato-kogyo.co.jp">info@yamato-kogyo.co.jp</a> へ。</p>
      <form><input name="q"><button>送信</button></form></body></html>`,
  },
};

// --- サイトC: トップのみ・リンクなし・メールなし ---
sites["/c"] = {
  "/c/": { html: `<html><head><title>丸井製作所</title></head><body><h1>丸井製作所</h1><p>板金加工。</p></body></html>` },
};

// --- サイトD: 問い合わせページが JS レンダリングで本文ほぼ空 ---
sites["/d"] = {
  "/d/": { html: `<html><head><title>ダイワ機械</title></head><body><a href="/d/contact/">お問い合わせ</a><p>産業機械の設計製造。</p></body></html>` },
  "/d/contact/": { html: `<html><head><title>お問い合わせ</title></head><body><div id="app"></div><script>renderForm()</script></body></html>` },
};

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nDisallow: /admin/\n");
      return;
    }
    const site = Object.keys(sites).find((prefix) => url.startsWith(prefix));
    const page = site ? sites[site][url] : undefined;
    if (!page) {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<html><body>404</body></html>");
      return;
    }
    const charset = page.charset ?? "utf-8";
    const body = charset === "shift_jis" ? iconv.encode(page.html, "shift_jis") : Buffer.from(page.html, "utf-8");
    res.writeHead(page.status ?? 200, { "content-type": `text/html; charset=${charset === "shift_jis" ? "Shift_JIS" : "utf-8"}` });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("実サイト相当のクロール（サイトA: Shift_JIS + テーブル + 営業お断り）", () => {
  it("文字コードを判定し、テーブル内の本文・電話番号・営業拒否表記を取得する", async () => {
    const s = await crawlSite(`${base}/a/`, { maxPages: 10, delayMs: 0 });
    const all = s.pages.map((p) => p.text).join("\n");
    expect(all).toContain("株式会社大阪精密工業");
    expect(all).toContain("金属部品の精密加工");
    expect(all).toContain("大阪府大阪市中央区本町");

    // 拡張子付き URL（.html / .php）も分類できる
    const types = s.pages.map((p) => p.pageType);
    expect(types).toContain("company");
    expect(types).toContain("recruit");
    expect(types).toContain("contact");

    // 全角の電話番号を正規化して取得
    expect(s.phones).toContain("06-6123-4567");

    // 営業拒否表記を検出
    expect(s.salesRestrictions.length).toBeGreaterThan(0);
    expect(s.salesRestrictions[0].sourceUrl).toContain("/a/inquiry.php");

    // "info(at)domain" 形式の難読化メールを復元
    expect(s.emails).toContain("info@osaka-seimitsu.co.jp");

    expect(s.contactPageUrl).toContain("/a/inquiry.php");
    expect(s.contactFormUrl).toContain("/a/inquiry.php");
    expect(s.recruitPageUrl).toContain("/a/recruit/");
  });
});

describe("実サイト相当のクロール（サイトB: SNS + 新卒/中途 + 別ドメインのメール混入）", () => {
  it("公式SNSのみ抽出し、シェアリンクは除外する", async () => {
    const s = await crawlSite(`${base}/b/`, { maxPages: 10, delayMs: 0 });
    expect(s.social.instagram_url).toBe("https://www.instagram.com/yamato_kogyo");
    expect(s.social.x_url).toBe("https://x.com/yamato_kogyo");
    expect(s.social.facebook_url).toBeNull();
  });

  it("制作会社のメールも検出はするが、企業ドメインのメールが優先候補になる", async () => {
    const s = await crawlSite(`${base}/b/`, { maxPages: 10, delayMs: 0 });
    expect(s.emails).toContain("info@yamato-kogyo.co.jp");
    expect(s.emails).toContain("contact@web-seisaku-agency.jp");
  });

  it("新卒・中途の記載と社員インタビューを含む採用ページを取得する", async () => {
    const s = await crawlSite(`${base}/b/`, { maxPages: 10, delayMs: 0 });
    const recruitText = s.pages.filter((p) => p.pageType.startsWith("recruit") || p.pageType === "employee").map((p) => p.text).join("\n");
    expect(recruitText).toContain("新卒採用");
    expect(recruitText).toContain("中途採用");
    expect(s.recruitPageUrl).toContain("/b/saiyo/");
  });
});

describe("実サイト相当のクロール（サイトC: トップのみ・情報なし）", () => {
  it("メールアドレスを推測生成せず、空のまま返す", async () => {
    const s = await crawlSite(`${base}/c/`, { maxPages: 10, delayMs: 0 });
    expect(s.emails).toEqual([]);
    expect(s.contactPageUrl).toBeNull();
    expect(s.recruitPageUrl).toBeNull();
    expect(s.salesRestrictions).toEqual([]);
    expect(s.pages.length).toBe(1);
  });
});

describe("実サイト相当のクロール（サイトD: 問い合わせページが JS レンダリング）", () => {
  it("本文が空でもクロール自体は成功し、営業拒否表記は検出されない", async () => {
    const s = await crawlSite(`${base}/d/`, { maxPages: 10, delayMs: 0 });
    const contact = s.pages.find((p) => p.pageType === "contact");
    expect(contact).toBeDefined();
    expect((contact?.text ?? "").trim().length).toBe(0);
    expect(s.salesRestrictions).toEqual([]);
  });
});

describe("営業拒否表記の実表現バリエーション", () => {
  it.each([
    "※営業目的でのお問い合わせは固くお断りいたします。",
    "営業・勧誘目的でのご連絡はご遠慮ください。",
    "当社への営業のお電話はお断りしております。",
    "セールス、勧誘等のご連絡はお受けしておりません。",
    "求人媒体・広告等の営業のご案内はお断りしております。",
  ])("検出: %s", (text) => {
    expect(detectSalesRestriction(text, "https://example.co.jp/contact/").length).toBeGreaterThan(0);
  });

  it.each([
    "営業時間：平日9:00〜18:00",
    "大阪営業所を開設しました。",
    "営業職を募集しています。",
  ])("誤検出しない: %s", (text) => {
    expect(detectSalesRestriction(text, "https://example.co.jp/")).toEqual([]);
  });
});
