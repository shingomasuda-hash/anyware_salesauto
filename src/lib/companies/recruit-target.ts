import type { RecruitTarget } from "@/db/types";
import type { CrawlSummary, PageType } from "@/lib/crawler/types";

/**
 * 営業ターゲットとしての採用状況の区分は @/db/types の RecruitTarget。
 *
 * 狙いは「採用で困っていそう」「採用に力を入れていそう」
 * 「採用はしていそうだが公式サイトに採用ページが無い」の3つ。
 * 採用の痕跡がまったく無い企業（no_signal）は対象外とする。
 */
export type { RecruitTarget };

export const RECRUIT_TARGET_LABELS: Record<RecruitTarget, string> = {
  no_recruit_page: "採用ページなし（採用の痕跡あり）",
  weak_recruit_page: "採用ページが手薄",
  active_recruit: "採用に注力",
  no_signal: "採用の痕跡なし",
};

export const RECRUIT_TARGET_OPTIONS: { key: RecruitTarget; label: string; description: string }[] = [
  { key: "no_recruit_page", label: RECRUIT_TARGET_LABELS.no_recruit_page, description: "求人媒体や本文に採用の記載はあるが、公式サイトに採用ページが無い" },
  { key: "weak_recruit_page", label: RECRUIT_TARGET_LABELS.weak_recruit_page, description: "採用ページはあるが、募集要項・社員紹介などが不足している" },
  { key: "active_recruit", label: RECRUIT_TARGET_LABELS.active_recruit, description: "採用ページが充実しており、採用に投資している" },
  { key: "no_signal", label: RECRUIT_TARGET_LABELS.no_signal, description: "採用の記載が見つからない（営業対象外）" },
];

/** 求人媒体。公式サイトに採用ページが無くても、ここへのリンクがあれば採用はしている */
const JOB_BOARDS: { domain: RegExp; name: string }[] = [
  { domain: /(^|\.)indeed\.com$/i, name: "Indeed" },
  { domain: /(^|\.)rikunabi\.com$|(^|\.)next\.rikunabi\.com$/i, name: "リクナビ" },
  { domain: /(^|\.)mynavi\.jp$/i, name: "マイナビ" },
  { domain: /(^|\.)doda\.jp$/i, name: "doda" },
  { domain: /(^|\.)en-japan\.com$|(^|\.)employment\.en-japan\.com$/i, name: "エン転職" },
  { domain: /(^|\.)en-gage\.net$/i, name: "engage" },
  { domain: /(^|\.)wantedly\.com$/i, name: "Wantedly" },
  { domain: /(^|\.)baitoru\.com$/i, name: "バイトル" },
  { domain: /(^|\.)townwork\.net$/i, name: "タウンワーク" },
  { domain: /(^|\.)hellowork\.mhlw\.go\.jp$|(^|\.)hellowork\.go\.jp$/i, name: "ハローワーク" },
  { domain: /(^|\.)job-medley\.com$/i, name: "ジョブメドレー" },
  { domain: /(^|\.)green-japan\.com$/i, name: "Green" },
  { domain: /(^|\.)type\.jp$/i, name: "type" },
  { domain: /(^|\.)workport\.co\.jp$/i, name: "ワークポート" },
];

/** 本文中の求人媒体名（リンクが無くても名前だけ書かれていることがある） */
const JOB_BOARD_TEXT = /(Indeed|インディード|リクナビ|マイナビ|doda|デューダ|エン転職|engage|Wantedly|バイトル|タウンワーク|ハローワーク|ジョブメドレー)/i;

/** 採用していることを示す本文表現 */
const RECRUIT_TEXT = /(採用情報|求人情報|募集要項|社員募集|スタッフ募集|人材募集|募集中|求人|新卒採用|中途採用|キャリア採用|一緒に働く)/;

const RECRUIT_PAGE_TYPES: PageType[] = ["recruit", "recruit_new_graduate", "recruit_mid_career", "job_listing"];

export interface RecruitTargetInput {
  hasRecruitPage: boolean;
  /** 採用関連ページの数 */
  recruitPageCount: number;
  /** 募集要項ページがあるか */
  hasJobListing: boolean;
  /** 社員紹介ページがあるか */
  hasEmployeePage: boolean;
  /** 代表メッセージページがあるか */
  hasMessagePage: boolean;
  /** 採用関連ページの本文量（文字） */
  recruitTextLength: number;
  /** 検出した求人媒体 */
  jobBoards: string[];
  /** サイト内に採用・求人の記載があるか */
  recruitMentioned: boolean;
  /** トップページ等を実際に読めたか（読めていないと「無い」と判断できない） */
  crawledEnough: boolean;
}

export interface RecruitTargetResult {
  target: RecruitTarget;
  /** そう判断した根拠（画面に出して人が検算できるようにする） */
  reasons: string[];
  /** 検出した求人媒体 */
  jobBoards: string[];
}

/** 採用ページが「充実している」と言える下限 */
const ACTIVE_RECRUIT_TEXT_CHARS = 1200;

/**
 * 採用状況を区分する。クロールで取れた事実だけで判定し、AI は使わない。
 * 判断材料が足りないときは no_signal にせず weak 側へ倒さない（推測しない）。
 */
export function classifyRecruitTarget(input: RecruitTargetInput): RecruitTargetResult {
  const reasons: string[] = [];
  const jobBoards = input.jobBoards;

  if (input.hasRecruitPage) {
    const depth = [input.hasJobListing && "募集要項", input.hasEmployeePage && "社員紹介", input.hasMessagePage && "代表メッセージ"].filter(Boolean) as string[];
    reasons.push(`採用ページあり（採用関連 ${input.recruitPageCount}ページ）`);
    if (depth.length > 0) reasons.push(`掲載あり: ${depth.join(" / ")}`);
    if (input.jobBoards.length > 0) reasons.push(`求人媒体: ${input.jobBoards.join(" / ")}`);

    const rich = depth.length >= 2 && input.recruitTextLength >= ACTIVE_RECRUIT_TEXT_CHARS;
    if (rich) return { target: "active_recruit", reasons, jobBoards };

    if (depth.length === 0) reasons.push("募集要項・社員紹介・メッセージのいずれも見つからない");
    if (input.recruitTextLength < ACTIVE_RECRUIT_TEXT_CHARS) reasons.push(`採用ページの情報量が少ない（${input.recruitTextLength}字）`);
    return { target: "weak_recruit_page", reasons, jobBoards };
  }

  // 採用ページは無いが、採用している痕跡がある
  if (input.jobBoards.length > 0) {
    reasons.push(`公式サイトに採用ページが無い / 求人媒体を利用: ${input.jobBoards.join(" / ")}`);
    return { target: "no_recruit_page", reasons, jobBoards };
  }
  if (input.recruitMentioned) {
    reasons.push("公式サイトに採用ページが無いが、本文に採用・求人の記載がある");
    return { target: "no_recruit_page", reasons, jobBoards };
  }

  if (!input.crawledEnough) {
    reasons.push("サイトを十分に読めていないため判断できない");
    return { target: "no_signal", reasons, jobBoards };
  }
  reasons.push("採用・求人の記載が見つからない");
  return { target: "no_signal", reasons, jobBoards };
}

/** クロール結果から採用状況を判定する */
export function classifyRecruitTargetFromCrawl(summary: CrawlSummary): RecruitTargetResult {
  const recruitPages = summary.pages.filter((p) => RECRUIT_PAGE_TYPES.includes(p.pageType));
  const allText = summary.pages.map((p) => p.text).join("\n");
  const linkTexts = summary.pages.flatMap((p) => p.links.map((l) => l.text)).join(" ");

  const boards = new Set<string>();
  for (const page of summary.pages) {
    for (const link of page.links) {
      try {
        const host = new URL(link.url).hostname;
        for (const b of JOB_BOARDS) if (b.domain.test(host)) boards.add(b.name);
      } catch {
        /* 相対URL等は無視 */
      }
    }
  }
  for (const m of allText.match(new RegExp(JOB_BOARD_TEXT, "gi")) ?? []) boards.add(m);

  return classifyRecruitTarget({
    hasRecruitPage: Boolean(summary.recruitPageUrl),
    recruitPageCount: recruitPages.length,
    hasJobListing: summary.pages.some((p) => p.pageType === "job_listing"),
    hasEmployeePage: summary.pages.some((p) => p.pageType === "employee"),
    hasMessagePage: summary.pages.some((p) => p.pageType === "message"),
    recruitTextLength: recruitPages.reduce((sum, p) => sum + p.text.length, 0),
    jobBoards: [...boards],
    recruitMentioned: RECRUIT_TEXT.test(allText) || RECRUIT_TEXT.test(linkTexts),
    crawledEnough: summary.pages.some((p) => p.text.length > 200),
  });
}
