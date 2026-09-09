import type { CrawledPage } from "@/lib/crawler/types";

export type RecruitingSignal = "yes" | "no" | "unknown";

const RECRUIT_PATTERNS = /採用|求人|募集要項|社員募集|リクルート|recruit|career|新卒|中途|entry|エントリー/i;
const RECRUIT_URL_PATTERNS = /(recruit|career|saiyo|saiyou|job|kyujin|entry|employment)/i;

/**
 * Claude を呼ぶ前に、ルールベースで採用活動の有無を判定する。
 * 判定できない場合は unknown（推測で yes/no にしない）。
 */
export function detectRecruitingSignal(pages: { url: string; text: string; linkTexts?: string[] }[]): RecruitingSignal {
  if (pages.length === 0) return "unknown";
  for (const p of pages) {
    if (RECRUIT_URL_PATTERNS.test(p.url)) return "yes";
    if (RECRUIT_PATTERNS.test(p.text)) return "yes";
    for (const t of p.linkTexts ?? []) if (RECRUIT_PATTERNS.test(t)) return "yes";
  }
  // トップページを取得できているのに採用の痕跡が無ければ「なし」と判断できる
  return pages.some((p) => p.text.length > 200) ? "no" : "unknown";
}

export interface DigitalSignals {
  hasRecruitPage: boolean;
  hasContactForm: boolean;
  hasPublicEmail: boolean;
  snsCount: number;
  recruiting: RecruitingSignal;
}

export function summarizeDigitalSignals(input: {
  pages: CrawledPage[];
  recruitPageUrl: string | null;
  contactFormUrl: string | null;
  email: string | null;
  social: Record<string, string | null>;
}): DigitalSignals {
  return {
    hasRecruitPage: Boolean(input.recruitPageUrl),
    hasContactForm: Boolean(input.contactFormUrl),
    hasPublicEmail: Boolean(input.email),
    snsCount: Object.values(input.social).filter(Boolean).length,
    recruiting: detectRecruitingSignal(
      input.pages.map((p) => ({ url: p.url, text: p.text, linkTexts: p.links.map((l) => l.text) })),
    ),
  };
}
