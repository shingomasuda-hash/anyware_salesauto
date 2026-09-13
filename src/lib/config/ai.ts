import { getEnv } from "./env";

/** Claude モデル設定（コードに直書きしない） */
export function getAiConfig() {
  const env = getEnv();
  return {
    model: env.ANTHROPIC_MODEL,
    maxOutputTokens: env.ANTHROPIC_MAX_OUTPUT_TOKENS,
    effort: env.ANTHROPIC_EFFORT,
    /** 分析1回あたりに Claude へ渡す本文テキストの上限（文字） */
    maxContextChars: env.ANTHROPIC_MAX_CONTEXT_CHARS,
    /**
     * 不正 JSON 時の再試行回数。
     * 再試行はそれまでの会話をまるごと送り直すため、1回で入力費用がほぼ倍になる。
     * 構造化出力を使っている以上スキーマ違反は稀なので 1 回に留める。
     */
    maxParseRetries: 1,
    /**
     * AI分析を行うか。
     * false にするとリスト作成（探索・公式サイト確認・クロール・採用状況の判定）だけを行い、
     * AI は一切呼ばない＝費用が発生しない。
     */
    analysisEnabled: env.AI_ANALYSIS_ENABLED,
    /** 採用・求人の痕跡がある企業だけ分析するか */
    requireRecruitSignal: env.ANALYSIS_REQUIRE_RECRUIT_SIGNAL,
    /** 当月の費用上限（円）。0 以下で上限なし */
    monthlyBudgetJpy: env.AI_MONTHLY_BUDGET_JPY,
  } as const;
}
