import type { CrawlSummary, PageType } from "@/lib/crawler/types";

export interface AnalysisPriorityInput {
  /** 採用ページを見つけたか */
  hasRecruitPage: boolean;
  /** 採用関連ページの数（募集要項・新卒・中途など） */
  recruitPageCount: number;
  /** 問い合わせ手段（フォーム・メール・電話）の数 */
  contactChannels: number;
  /** 検出した SNS アカウント数 */
  snsCount: number;
  /** クロールできたページ数 */
  pageCount: number;
  /** 営業を断る表記が見つかったか */
  salesRestricted: boolean;
}

/**
 * AI 分析の順番を決めるスコア（0-100）。
 *
 * 月の AI 予算に上限があるため、予算を使い切る前に「見込みの高い企業」から
 * 分析されるようにする。ここで使うのはクロールで機械的に取れた事実だけで、
 * AI は一切使わない（順番を決めるために費用をかけない）。
 */
export function analysisPriority(input: AnalysisPriorityInput): number {
  if (input.salesRestricted) return 0; // 営業できない企業は最後
  let score = 0;
  if (input.hasRecruitPage) score += 30;
  score += Math.min(15, input.recruitPageCount * 5); // 採用ページが充実しているほど分析価値が高い
  score += Math.min(25, input.contactChannels * 10); // 連絡手段がないと営業できない
  score += Math.min(15, input.snsCount * 5);
  score += Math.min(15, Math.floor(input.pageCount / 2) * 3); // 情報量があるほど分析の精度が上がる
  return Math.max(0, Math.min(100, score));
}

/** クロール結果から優先度スコアを求める */
export function analysisPriorityFromCrawl(summary: CrawlSummary, email: string | null, phone: string | null): number {
  const recruitTypes: PageType[] = ["recruit", "recruit_new_graduate", "recruit_mid_career", "job_listing"];
  return analysisPriority({
    hasRecruitPage: Boolean(summary.recruitPageUrl),
    recruitPageCount: summary.pages.filter((p) => recruitTypes.includes(p.pageType)).length,
    contactChannels: [summary.contactFormUrl, summary.contactPageUrl, email, phone].filter(Boolean).length,
    snsCount: Object.values(summary.social).filter(Boolean).length,
    pageCount: summary.pages.length,
    salesRestricted: summary.salesRestrictions.length > 0,
  });
}
