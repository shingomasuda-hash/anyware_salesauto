import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAiConfig } from "@/lib/config/ai";
import { requireEnv } from "@/lib/config/env";
import { getSalesOffering } from "@/lib/config/offering";
import { buildCompanyAnalysisSystemPrompt, buildCompanyAnalysisUserPrompt, JSON_FIX_PROMPT } from "./prompts";
import type { AiProvider, AiUsage, AnalysisRequest, AnalysisResult } from "./provider";
import { companyAnalysisOutputSchema, extractJsonObject, parseAnalysisOutput, type CompanyAnalysisOutput } from "./schemas";

/**
 * Claude API を使った企業分析。
 * - 構造化出力 (output_config.format + zod) で JSON を受け取る
 * - パース失敗 / スキーマ違反時はエラー内容を添えて再試行
 * - トークン使用量を返す（呼び出し側で ai_usage_logs に記録）
 */
export class AnthropicAiProvider implements AiProvider {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(apiKey: string = requireEnv("ANTHROPIC_API_KEY")) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 180_000 });
  }

  async analyzeCompany(request: AnalysisRequest): Promise<AnalysisResult> {
    const cfg = getAiConfig();
    const started = Date.now();
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: buildCompanyAnalysisUserPrompt(request.contextText) }];

    let lastError = "";
    for (let attempt = 0; attempt <= cfg.maxParseRetries; attempt++) {
      const response = await this.client.messages.parse({
        model: cfg.model,
        max_tokens: cfg.maxOutputTokens,
        // 自社サービス定義は企業をまたいで同一なので、system に置いてもキャッシュが効く
        system: [{ type: "text", text: buildCompanyAnalysisSystemPrompt(getSalesOffering()), cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { format: zodOutputFormat(companyAnalysisOutputSchema), effort: cfg.effort },
      });

      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;
      usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
      usage.cacheCreationTokens += response.usage.cache_creation_input_tokens ?? 0;

      if (response.stop_reason === "refusal") {
        throw new Error(`Claude が応答を拒否しました (${response.stop_details?.category ?? "unknown"})`);
      }

      let candidate: unknown = response.parsed_output ?? null;
      const rawText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (candidate === null) {
        try {
          candidate = extractJsonObject(rawText);
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          candidate = null;
        }
      }

      const validated = candidate === null ? { ok: false as const, error: lastError || "JSON パース失敗" } : parseAnalysisOutput(candidate);
      if (validated.ok) {
        return {
          output: validated.data as CompanyAnalysisOutput,
          usage,
          model: response.model,
          provider: "anthropic",
          durationMs: Date.now() - started,
          retries: attempt,
        };
      }
      lastError = validated.error;
      // 再試行: これまでの応答と修正指示を会話に追加
      messages.push({ role: "assistant", content: rawText || "{}" });
      messages.push({ role: "user", content: `${JSON_FIX_PROMPT}${lastError}` });
    }
    throw new Error(`AI 応答のスキーマ検証に失敗（${cfg.maxParseRetries + 1}回試行）: ${lastError}`);
  }
}
