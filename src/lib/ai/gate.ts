import type { Db } from "@/db";
import type { CompanyRow } from "@/db/types";
import { getAiConfig } from "@/lib/config/ai";
import { checkMonthlyBudget } from "./pricing";

export interface AnalysisGate {
  allowed: boolean;
  /** 見送った理由（ログ・ジョブ結果に残す）。allowed=true のときは null */
  reason: string | null;
}

/**
 * AI 分析を実行してよいかの判定。
 *
 * 費用は「何社に AI を使うか」でほぼ決まるため、実際に API を叩く直前でここを通す。
 * - 採用ページを確認できていない企業は分析しない（営業リストの条件でもあり、最大の費用削減要因）
 * - 当月の費用が上限に達していたら分析しない（クロールと探索は止めない）
 */
export async function checkAnalysisAllowed(db: Db, company: CompanyRow): Promise<AnalysisGate> {
  const cfg = getAiConfig();
  if (cfg.requireRecruitPage && !company.recruit_page_url) {
    return { allowed: false, reason: "採用ページを確認できないため分析対象外（ANALYSIS_REQUIRE_RECRUIT_PAGE=true）" };
  }
  const budget = await checkMonthlyBudget(db);
  if (!budget.allowed) return { allowed: false, reason: budget.reason };
  return { allowed: true, reason: null };
}

/** クロール直後に分析ジョブを投入してよいか（採用ページの有無だけで判断する軽い版） */
export function shouldEnqueueAnalysis(recruitPageUrl: string | null): { ok: boolean; reason: string | null } {
  if (getAiConfig().requireRecruitPage && !recruitPageUrl) {
    return { ok: false, reason: "採用ページが見つからないため AI 分析を見送り" };
  }
  return { ok: true, reason: null };
}
