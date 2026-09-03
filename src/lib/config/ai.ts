import { getEnv } from "./env";

/** Claude モデル設定（コードに直書きしない） */
export function getAiConfig() {
  const env = getEnv();
  return {
    model: env.ANTHROPIC_MODEL,
    maxOutputTokens: env.ANTHROPIC_MAX_OUTPUT_TOKENS,
    effort: env.ANTHROPIC_EFFORT,
    /** 分析1回あたりに Claude へ渡す本文テキストの上限（文字） */
    maxContextChars: 24_000,
    /** 不正 JSON 時の再試行回数 */
    maxParseRetries: 2,
  } as const;
}
