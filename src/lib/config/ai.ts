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
    /** 採用ページを確認できた企業だけ分析するか */
    requireRecruitPage: env.ANALYSIS_REQUIRE_RECRUIT_PAGE,
    /** 当月の費用上限（円）。0 以下で上限なし */
    monthlyBudgetJpy: env.AI_MONTHLY_BUDGET_JPY,
  } as const;
}
