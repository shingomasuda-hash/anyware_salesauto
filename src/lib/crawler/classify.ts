import type { PageType } from "./types";

interface Rule {
  type: PageType;
  url: RegExp;
  text: RegExp;
  priority: number;
}

/** URL / リンクテキスト / タイトル からページ種別を判定。priority が高いほど優先的にクロール */
const RULES: Rule[] = [
  { type: "recruit_new_graduate", url: /(newgrad|new-grad|shinsotsu|fresh|graduate)/i, text: /新卒|学生|20\d\d年?卒/, priority: 100 },
  { type: "recruit_mid_career", url: /(mid-?career|chuto|tenshoku|experienced|keikensha)/i, text: /中途|キャリア採用|経験者/, priority: 100 },
  { type: "job_listing", url: /(job|jobs|position|opening|boshu|kyujin|entry)/i, text: /求人|募集要項|募集職種|募集中|エントリー/, priority: 85 },
  { type: "recruit", url: /(recruit|careers?|saiyo|saiyou|employment|join)/i, text: /採用|リクルート|求人|一緒に働く/, priority: 95 },
  { type: "company", url: /(company|about|corporate|profile|outline|gaiyo|gaiyou|kaisha|overview)/i, text: /会社概要|企業情報|会社案内|企業概要|会社情報|私たちについて/, priority: 100 },
  { type: "business", url: /(business|service|services|products?|jigyo|jigyou|solution|works)/i, text: /事業内容|事業紹介|サービス|製品|商品|業務内容|取扱/, priority: 80 },
  { type: "message", url: /(message|greeting|ceo|president|top-message|aisatsu)/i, text: /代表挨拶|代表メッセージ|トップメッセージ|社長|ご挨拶/, priority: 60 },
  { type: "employee", url: /(staff|member|people|interview|voice|crosstalk)/i, text: /社員紹介|スタッフ紹介|社員インタビュー|先輩社員|社員の声|メンバー/, priority: 65 },
  { type: "news", url: /(news|topics|info|information|release|blog|oshirase)/i, text: /ニュース|お知らせ|新着情報|トピックス|プレスリリース|ブログ/, priority: 50 },
  { type: "contact", url: /(contact|inquiry|toiawase|otoiawase|form)/i, text: /お問い?合わせ|お問合せ|ご相談|資料請求|コンタクト/, priority: 92 },
  { type: "privacy", url: /(privacy|policy|terms|kiyaku|sitemap|legal)/i, text: /プライバシー|個人情報|利用規約|サイトポリシー|サイトマップ/, priority: 30 },
];

export function classifyPage(url: string, linkText: string | null, title: string | null, homeOrigin: string): { type: PageType; priority: number } {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    if ((path === "" || /^\/(index|home|top)(\.html?|\.php)?$/i.test(path)) && u.origin === homeOrigin) {
      return { type: "top", priority: 110 };
    }
  } catch {
    return { type: "other", priority: 0 };
  }
  const hay = `${linkText ?? ""} ${title ?? ""}`;
  let best: { type: PageType; priority: number } | null = null;
  for (const r of RULES) {
    const urlHit = r.url.test(url);
    const textHit = r.text.test(hay);
    if (urlHit || textHit) {
      const p = r.priority + (urlHit && textHit ? 10 : 0);
      if (!best || p > best.priority) best = { type: r.type, priority: p };
    }
  }
  return best ?? { type: "other", priority: 10 };
}

/** 画像・PDF・外部ファイル等はクロール対象外 */
export function isCrawlableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    if (/\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|ico|xml|rss)(\?|$)/i.test(u.pathname)) return false;
    if (/\/(wp-admin|wp-login|cart|login|logout|admin|feed|tag|category|page\/\d+)/i.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** 同一サイト判定（www. の有無は同一とみなす） */
export function isSameSite(url: string, homeUrl: string): boolean {
  try {
    const a = new URL(url).hostname.replace(/^www\./, "");
    const b = new URL(homeUrl).hostname.replace(/^www\./, "");
    return a === b;
  } catch {
    return false;
  }
}
