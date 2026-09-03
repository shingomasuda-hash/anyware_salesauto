import { getEnv, isMockMode } from "@/lib/config/env";
import { AnthropicAiProvider } from "./anthropic";
import { MockAiProvider } from "./mock";
import type { AiProvider } from "./provider";

export function getAiProvider(): AiProvider {
  if (isMockMode()) return new MockAiProvider();
  if (!getEnv().ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が未設定です。DATA_MODE=mock にするか、Claude API キーを設定してください。");
  }
  return new AnthropicAiProvider();
}

export type { AiProvider, AnalysisRequest, AnalysisResult } from "./provider";
export { companyAnalysisOutputSchema, parseAnalysisOutput, type CompanyAnalysisOutput } from "./schemas";
