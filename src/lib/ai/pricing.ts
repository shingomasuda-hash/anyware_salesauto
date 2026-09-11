import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { aiUsageLogs } from "@/db/schema";
import { getEnv } from "@/lib/config/env";

/**
 * 公開されている 100万トークンあたりの単価（USD）。
 * 請求の正は Anthropic Console の Billing。ここでの計算は運用判断のための概算。
 */
export const MODEL_RATES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

/** キャッシュ書き込みは入力の1.25倍、読み込みは0.1倍 */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** トークン使用量から USD を計算する。単価が未知のモデルは null（0 と区別する） */
export function usdFor(model: string, usage: TokenUsage): number | null {
  const rate = MODEL_RATES[model];
  if (!rate) return null;
  const per = (tokens: number, perMillion: number) => (tokens / 1_000_000) * perMillion;
  return (
    per(usage.inputTokens, rate.input) +
    per(usage.outputTokens, rate.output) +
    per(usage.cacheCreationTokens, rate.input * CACHE_WRITE_MULTIPLIER) +
    per(usage.cacheReadTokens, rate.input * CACHE_READ_MULTIPLIER)
  );
}

/** 当月（1日 00:00 〜）の開始時刻 */
export function currentMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface MonthlySpend {
  usd: number;
  jpy: number;
  budgetJpy: number;
  remainingJpy: number;
  /** 単価が分からないモデルの呼び出しが含まれていたか（費用が過小評価されている可能性） */
  hasUnknownModel: boolean;
  since: string;
}

/**
 * 当月の Claude API 費用を ai_usage_logs から集計する。
 * 「実際に記録したトークン数」からの算出であり、推測値ではない。
 */
export async function getMonthlySpend(db: Db, now = new Date()): Promise<MonthlySpend> {
  const env = getEnv();
  const since = currentMonthStart(now);
  const rows = await db
    .select({
      model: aiUsageLogs.model,
      input: sql<number>`coalesce(sum(${aiUsageLogs.input_tokens}), 0)`,
      output: sql<number>`coalesce(sum(${aiUsageLogs.output_tokens}), 0)`,
      cacheRead: sql<number>`coalesce(sum(${aiUsageLogs.cache_read_tokens}), 0)`,
      cacheWrite: sql<number>`coalesce(sum(${aiUsageLogs.cache_creation_tokens}), 0)`,
    })
    .from(aiUsageLogs)
    .where(and(eq(aiUsageLogs.success, true), gte(aiUsageLogs.created_at, since.toISOString())))
    .groupBy(aiUsageLogs.model);

  let usd = 0;
  let hasUnknownModel = false;
  for (const r of rows) {
    const cost = usdFor(r.model ?? "", {
      inputTokens: Number(r.input) || 0,
      outputTokens: Number(r.output) || 0,
      cacheReadTokens: Number(r.cacheRead) || 0,
      cacheCreationTokens: Number(r.cacheWrite) || 0,
    });
    if (cost === null) hasUnknownModel = true;
    else usd += cost;
  }

  const jpy = usd * env.AI_USD_JPY_RATE;
  return {
    usd,
    jpy,
    budgetJpy: env.AI_MONTHLY_BUDGET_JPY,
    remainingJpy: env.AI_MONTHLY_BUDGET_JPY - jpy,
    hasUnknownModel,
    since: since.toISOString(),
  };
}

export interface BudgetVerdict {
  allowed: boolean;
  reason: string | null;
  spend: MonthlySpend;
}

/**
 * 当月の AI 予算内かを判定する。
 * 予算 0 以下は「上限なし」とみなす（意図しない停止を防ぐ）。
 */
export async function checkMonthlyBudget(db: Db, now = new Date()): Promise<BudgetVerdict> {
  const spend = await getMonthlySpend(db, now);
  if (spend.budgetJpy <= 0) return { allowed: true, reason: null, spend };
  if (spend.jpy >= spend.budgetJpy) {
    return {
      allowed: false,
      reason: `当月のAI予算に到達しました（使用 ${Math.round(spend.jpy)}円 / 上限 ${spend.budgetJpy}円）。AI_MONTHLY_BUDGET_JPY を見直すか、翌月まで待ってください。`,
      spend,
    };
  }
  return { allowed: true, reason: null, spend };
}
