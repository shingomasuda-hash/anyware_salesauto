import { normalizePhone, toHalfWidth } from "@/lib/companies/normalize";
import type { ExtractedLink, SocialLinks } from "./types";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const OBFUSCATED_EMAIL_RE = /([a-zA-Z0-9._%+-]+)\s*[\[（(【]\s*(?:at|アット|＠)\s*[\]）)】]\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;
const PLACEHOLDER_RE = /^(example|sample|test|xxx|your|name|user|mail|email|info@example)/i;

/**
 * メールアドレス抽出。
 * - 画像ファイル名やプレースホルダを除外
 * - "info [at] example.co.jp" 形式の難読化も復元
 * - 見つからない場合は空配列（推測して生成しない）
 */
export function extractEmails(text: string, html?: string): string[] {
  const set = new Set<string>();
  const sources = [text, html ?? ""];
  for (const src of sources) {
    const half = toHalfWidth(src);
    for (const m of half.match(EMAIL_RE) ?? []) {
      const e = m.toLowerCase().replace(/^[._-]+/, "");
      if (IMAGE_EXT_RE.test(e)) continue;
      if (PLACEHOLDER_RE.test(e) || /@(example|sample|test)\./.test(e)) continue;
      if (/@\d+\.\d+/.test(e)) continue; // バージョン番号などの誤検出
      if (e.length > 100) continue;
      set.add(e);
    }
    let om: RegExpExecArray | null;
    const re = new RegExp(OBFUSCATED_EMAIL_RE.source, "gi");
    while ((om = re.exec(half)) !== null) {
      const e = `${om[1]}@${om[2]}`.toLowerCase();
      if (!PLACEHOLDER_RE.test(e)) set.add(e);
    }
  }
  return Array.from(set);
}

/** mailto: リンクからも抽出 */
export function extractMailtoEmails(links: ExtractedLink[]): string[] {
  const set = new Set<string>();
  for (const l of links) {
    if (l.url.toLowerCase().startsWith("mailto:")) {
      const e = l.url.slice(7).split("?")[0].trim().toLowerCase();
      if (EMAIL_RE.test(e) && !/@(example|sample|test)\./.test(e)) set.add(e);
    }
  }
  return Array.from(set);
}

const PHONE_RE = /(?:TEL|Tel|tel|電話|℡|☎)?[\s:：]*(0\d{1,4}[-‐−ー－(（]?\d{1,4}[-‐−ー－)）]?\d{3,4})/g;

/** 日本の電話番号を抽出（10〜11桁、先頭0） */
export function extractPhones(text: string): string[] {
  const set = new Set<string>();
  const half = toHalfWidth(text);
  let m: RegExpExecArray | null;
  const re = new RegExp(PHONE_RE.source, "g");
  while ((m = re.exec(half)) !== null) {
    const p = normalizePhone(m[1]);
    if (p) {
      const digits = p.replace(/\D/g, "");
      // 郵便番号(7桁)や年月日の誤検出を除外
      if (digits.length >= 10 && digits.length <= 11 && /^0[1-9]/.test(digits)) set.add(p);
    }
  }
  return Array.from(set);
}

const SOCIAL_PATTERNS: { key: keyof SocialLinks; re: RegExp; exclude?: RegExp }[] = [
  { key: "instagram_url", re: /^https?:\/\/(www\.)?instagram\.com\/[^/?#]+/i, exclude: /instagram\.com\/(p|explore|accounts|share)\// },
  { key: "facebook_url", re: /^https?:\/\/(www\.|m\.)?facebook\.com\/[^/?#]+/i, exclude: /facebook\.com\/(sharer|share|dialog|login|plugins)/ },
  { key: "x_url", re: /^https?:\/\/(www\.)?(twitter|x)\.com\/[^/?#]+/i, exclude: /(twitter|x)\.com\/(intent|share|home|search|i\/)/ },
  { key: "youtube_url", re: /^https?:\/\/(www\.)?youtube\.com\/(channel\/|c\/|user\/|@)[^/?#]+/i },
  { key: "linkedin_url", re: /^https?:\/\/([a-z]{2}\.)?linkedin\.com\/(company|in|school)\/[^/?#]+/i, exclude: /linkedin\.com\/share/ },
  { key: "tiktok_url", re: /^https?:\/\/(www\.)?tiktok\.com\/@[^/?#]+/i },
];

/** SNS 公式アカウントリンクを抽出（シェアボタン等は除外） */
export function extractSocialLinks(links: ExtractedLink[]): SocialLinks {
  const result: SocialLinks = { instagram_url: null, facebook_url: null, x_url: null, youtube_url: null, linkedin_url: null, tiktok_url: null };
  for (const l of links) {
    for (const p of SOCIAL_PATTERNS) {
      if (result[p.key]) continue;
      if (p.exclude?.test(l.url)) continue;
      const m = l.url.match(p.re);
      if (m) result[p.key] = m[0];
    }
  }
  return result;
}

/** 問い合わせフォームらしさの判定 */
export function looksLikeContactForm(url: string, hasForm: boolean, text: string): boolean {
  if (!hasForm) return false;
  return /contact|inquiry|toiawase|form/i.test(url) || /お問い?合わせ|お問合せ|ご相談/.test(text.slice(0, 2000));
}
