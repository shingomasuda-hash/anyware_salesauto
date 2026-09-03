/**
 * モック企業サイト生成。
 * `mock-<slug>.example.jp` 形式のホストに対し、slug から決定論的に
 * 会社概要 / 事業内容 / 採用 / お知らせ / お問い合わせ ページを生成する。
 * 本番コードとは fetchHtml() 内の isMockUrl 判定でのみ接続される。
 */

export function isMockHost(host: string): boolean {
  return /^mock-[a-z0-9-]+\.example\.jp$/.test(host);
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface MockSiteProfile {
  slug: string;
  companyName: string;
  hasRecruit: boolean;
  hasNewGrad: boolean;
  hasMidCareer: boolean;
  hasInstagram: boolean;
  hasFacebook: boolean;
  hasX: boolean;
  hasYoutube: boolean;
  hasEmail: boolean;
  hasContactForm: boolean;
  salesRestricted: boolean;
  hasEmployeeInterview: boolean;
  modernSite: boolean;
  newsYear: number;
  phone: string;
  address: string;
  employeeCount: number;
}

export function mockProfileFromHost(host: string): MockSiteProfile {
  const slug = host.replace(/^mock-/, "").replace(/\.example\.jp$/, "");
  const h = hash(slug);
  const bit = (n: number) => ((h >> n) & 1) === 1;
  const companyName = mockCompanyName(slug);
  return {
    slug,
    companyName,
    hasRecruit: (h % 10) < 7,
    hasNewGrad: bit(1),
    hasMidCareer: bit(2) || (h % 10) < 7,
    hasInstagram: bit(3),
    hasFacebook: bit(4),
    hasX: bit(5),
    hasYoutube: bit(6) && bit(7),
    hasEmail: bit(8),
    hasContactForm: true,
    salesRestricted: (h % 7) === 0,
    hasEmployeeInterview: bit(10),
    modernSite: bit(11),
    newsYear: 2020 + (h % 6),
    phone: `06-${String(1000 + (h % 9000)).padStart(4, "0")}-${String((h >> 8) % 10000).padStart(4, "0")}`,
    address: `大阪府大阪市中央区本町${1 + (h % 4)}丁目${1 + ((h >> 3) % 20)}-${1 + ((h >> 7) % 30)}`,
    employeeCount: 10 + (h % 280),
  };
}

export function mockCompanyName(slug: string): string {
  const base = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `${base}株式会社`;
}

const layout = (title: string, body: string, p: MockSiteProfile) => `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>${title} | ${p.companyName}</title>
<meta name="description" content="${p.companyName}の${title}ページです。"></head>
<body>
<header><nav>
<a href="/">トップ</a> <a href="/company/">会社概要</a> <a href="/business/">事業内容</a>
${p.hasRecruit ? '<a href="/recruit/">採用情報</a>' : ""} <a href="/news/">お知らせ</a> <a href="/contact/">お問い合わせ</a>
</nav></header>
<main>${body}</main>
<footer>
<p>${p.companyName} 〒541-0053 ${p.address} TEL: ${p.phone}</p>
${p.hasInstagram ? `<a href="https://www.instagram.com/${p.slug}/">Instagram</a>` : ""}
${p.hasFacebook ? `<a href="https://www.facebook.com/${p.slug}">Facebook</a>` : ""}
${p.hasX ? `<a href="https://x.com/${p.slug}">X</a>` : ""}
${p.hasYoutube ? `<a href="https://www.youtube.com/@${p.slug}">YouTube</a>` : ""}
<p>© ${p.newsYear} ${p.companyName}</p>
</footer></body></html>`;

export function renderMockPage(url: string): { status: number; html: string } {
  const u = new URL(url);
  const p = mockProfileFromHost(u.hostname);
  const path = u.pathname.replace(/\/+$/, "") || "/";

  if (path === "/robots.txt") {
    return { status: 200, html: "User-agent: *\nDisallow: /admin/\n" };
  }
  if (path === "/") {
    return {
      status: 200,
      html: layout("トップ", `<h1>${p.companyName}</h1>
<p>私たちは大阪を拠点に${p.modernSite ? "最新設備と自社開発システムを活用した" : "創業以来の技術を守り続ける"}製造業の会社です。</p>
<p>金属部品の精密加工、産業機械向け部品の製造を主力事業としています。</p>
${p.hasRecruit ? '<section><h2>採用情報</h2><p>私たちと一緒に働く仲間を募集しています。<a href="/recruit/">採用情報はこちら</a></p></section>' : ""}
<section><h2>お知らせ</h2><ul><li>${p.newsYear}.04.01 新年度のご挨拶</li><li>${p.newsYear}.01.10 年始営業のお知らせ</li></ul></section>`, p),
    };
  }
  if (path === "/company") {
    return {
      status: 200,
      html: layout("会社概要", `<h1>会社概要</h1>
<table><tr><th>会社名</th><td>${p.companyName}</td></tr>
<tr><th>所在地</th><td>〒541-0053 ${p.address}</td></tr>
<tr><th>電話番号</th><td>${p.phone}</td></tr>
<tr><th>設立</th><td>19${70 + (p.employeeCount % 30)}年</td></tr>
<tr><th>従業員数</th><td>${p.employeeCount}名</td></tr>
<tr><th>事業内容</th><td>精密金属部品の製造・加工、産業機械部品の設計製造</td></tr>
<tr><th>代表者</th><td>代表取締役 山田 太郎</td></tr></table>
<h2>代表メッセージ</h2><p>ものづくりを通じて社会に貢献します。</p>`, p),
    };
  }
  if (path === "/business") {
    return {
      status: 200,
      html: layout("事業内容", `<h1>事業内容</h1><h2>精密加工事業</h2><p>NC旋盤、マシニングセンタによる精密部品加工。</p>
<h2>組立事業</h2><p>産業機械ユニットの組立・検査。</p>${p.modernSite ? "<h2>DX推進</h2><p>生産管理システムを自社開発し、工程の見える化を実現しています。</p>" : ""}`, p),
    };
  }
  if (path === "/recruit" && p.hasRecruit) {
    return {
      status: 200,
      html: layout("採用情報", `<h1>採用情報</h1>
${p.hasNewGrad ? "<h2>新卒採用</h2><p>2027年卒 技術職・営業職 募集中。</p>" : ""}
${p.hasMidCareer ? "<h2>中途採用</h2><ul><li>機械オペレーター（正社員）</li><li>品質管理担当（正社員）</li><li>営業職（正社員）</li></ul>" : ""}
${p.hasEmployeeInterview ? '<h2>社員インタビュー</h2><p>入社3年目の先輩社員に話を聞きました。</p><a href="/recruit/interview/">インタビューを見る</a>' : "<p>募集要項はハローワークをご確認ください。</p>"}
<p>ご応募は<a href="/contact/">お問い合わせフォーム</a>より。</p>`, p),
    };
  }
  if (path === "/recruit/interview" && p.hasRecruit && p.hasEmployeeInterview) {
    return { status: 200, html: layout("社員インタビュー", `<h1>社員インタビュー</h1><p>若手社員が語る職場の魅力。</p>`, p) };
  }
  if (path === "/news") {
    return {
      status: 200,
      html: layout("お知らせ", `<h1>お知らせ</h1><ul><li>${p.newsYear}.04.01 新年度のご挨拶</li><li>${p.newsYear}.01.10 年始営業のお知らせ</li><li>${p.newsYear - 1}.12.20 年末年始休業のお知らせ</li></ul>`, p),
    };
  }
  if (path === "/contact") {
    return {
      status: 200,
      html: layout("お問い合わせ", `<h1>お問い合わせ</h1>
<p>お電話: ${p.phone}（平日9:00〜17:00）</p>
${p.hasEmail ? `<p>メール: <a href="mailto:info@${u.hostname}">info@${u.hostname}</a></p>` : ""}
${p.salesRestricted ? "<p class=\"note\">※営業目的でのお問い合わせ・売り込みのご連絡は固くお断りしております。</p>" : ""}
<form action="/contact/send" method="post"><input name="name"><input name="email"><textarea name="body"></textarea><button>送信</button></form>`, p),
    };
  }
  return { status: 404, html: layout("Not Found", "<h1>404 Not Found</h1>", p) };
}
