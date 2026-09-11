import type { Db } from "@/db";
import type { CompanyRow, RecruitTarget } from "@/db/types";
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
 * - 採用の痕跡が無い企業は分析しない（営業ターゲットでないため。最大の費用削減要因）
 * - 当月の費用が上限に達していたら分析しない（クロールと探索は止めない）
 */
export async function checkAnalysisAllowed(db: Db, company: CompanyRow): Promise<AnalysisGate> {
  const cfg = getAiConfig();
  if (cfg.requireRecruitSignal && company.recruit_target === "no_signal") {
    return { allowed: false, reason: "採用・求人の記載が見つからないため分析対象外（ANALYSIS_REQUIRE_RECRUIT_SIGNAL=true）" };
  }
  const budget = await checkMonthlyBudget(db);
  if (!budget.allowed) return { allowed: false, reason: budget.reason };
  return { allowed: true, reason: null };
}

/**
 * クロール直後に分析ジョブを投入してよいか。
 *
 * 判断材料は「採用の痕跡があるか」であって、採用ページの有無ではない。
 * 公式サイトに採用ページが無い企業（求人媒体だけ使っている等）も営業ターゲットのため、
 * ここで落としてはいけない。
 */
export function shouldEnqueueAnalysis(target: RecruitTarget): { ok: boolean; reason: string | null } {
  if (getAiConfig().requireRecruitSignal && target === "no_signal") {
    return { ok: false, reason: "採用・求人の記載が見つからないため AI 分析を見送り" };
  }
  return { ok: true, reason: null };
}
