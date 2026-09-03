import type { CompanyAnalysisOutput } from "./schemas";

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface AnalysisResult {
  output: CompanyAnalysisOutput;
  usage: AiUsage;
  model: string;
  provider: "anthropic" | "mock";
  durationMs: number;
  retries: number;
}

export interface AnalysisRequest {
  contextText: string;
  /** モック用: 元データへのアクセス */
  mockHints?: {
    companyName: string;
    websiteUrl: string | null;
    pageTypes: string[];
    hasSns: boolean;
    hasEmail: boolean;
    hasContactForm: boolean;
    salesRestrictionText: string | null;
    salesRestrictionUrl: string | null;
    urls: string[];
  };
}

export interface AiProvider {
  readonly name: "anthropic" | "mock";
  analyzeCompany(request: AnalysisRequest): Promise<AnalysisResult>;
}
