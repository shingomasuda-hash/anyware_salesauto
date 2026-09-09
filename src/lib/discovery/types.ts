/**
 * Multi-Source Company Discovery の共通型。
 * Provider 固有の型はここに持ち込まず、各 Provider が DiscoveryCandidate へ変換する。
 */
import type { Json } from "@/db/types";

export type DiscoveryProviderName = "gbiz" | "google_places" | "web_search" | "edinet" | "official_web";

/** ユーザーの検索条件（UI から渡る） */
export interface DiscoveryCriteria {
  prefecture?: string;
  city?: string;
  /** 業種キー（INDUSTRIES） */
  industry?: string;
  /** 業種詳細キー（INDUSTRY_SUBCATEGORIES）。未指定なら業種から自動展開 */
  industrySubcategory?: string;
  /** 業種展開に使う追加キーワード */
  industryKeywords?: string[];
  employeeMin?: number;
  employeeMax?: number;
  keywords?: string[];
  recruitingRequired: boolean;
  websiteRequired: boolean;
  companyType?: string;
  maxResults: number;
}

/** Provider へ渡す 1 回分の検索指示 */
export interface DiscoveryQuery {
  /** 実行順の識別子（cursor 保存用） */
  id: string;
  provider: DiscoveryProviderName;
  /** 検索文字列（Places / Web Search 用） */
  text?: string;
  /** 構造化条件（GビズINFO 用） */
  criteria: DiscoveryCriteria;
  /** シャード情報（市区町村 × 業種細分） */
  shard?: { city?: string; subcategory?: string; label?: string };
  page?: number;
  limit?: number;
}

/** Provider が返す企業候補（この時点では companies に入れない） */
export interface DiscoveryCandidate {
  name: string;
  normalizedName: string;
  address: string | null;
  prefecture: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  domain: string | null;
  corporateNumber: string | null;
  industry: string | null;
  source: DiscoveryProviderName;
  sourceId: string | null;
  sourceUrl: string | null;
  /** その Provider 単体での確からしさ 0-100 */
  sourceConfidence: number;
  rawData: Json;
  discoveredAt: string;
}

/** 複数 Provider の観測をまとめた候補（重複排除後） */
export interface MergedCandidate extends DiscoveryCandidate {
  /** この候補に寄与した全 Provider の観測 */
  observations: DiscoveryCandidate[];
  /** 一致した Provider 名（重複排除で統合されたもの） */
  sources: DiscoveryProviderName[];
}

export interface DiscoveryContext {
  runId: string;
  criteria: DiscoveryCriteria;
  /** 予算超過の判定・記録 */
  budget: BudgetTracker;
  log: (level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => Promise<void>;
  /** この時刻を過ぎたら処理を打ち切る */
  deadline: number;
}

/**
 * 企業探索 Provider の共通インターフェース。
 * Provider 固有の処理は必ずこの実装内に閉じ込める。
 */
export interface CompanyDiscoveryProvider {
  readonly name: DiscoveryProviderName;
  /** APIキー等が設定されているか。未設定なら Discovery 全体を止めずに skip する */
  isAvailable(): boolean;
  /** 利用できない理由（UI・preflight 表示用） */
  unavailableReason(): string | null;
  search(query: DiscoveryQuery, context: DiscoveryContext): Promise<DiscoveryCandidate[]>;
  /** 候補の情報を補完する（法人番号の確定など）。任意実装 */
  enrich?(candidate: MergedCandidate, context: DiscoveryContext): Promise<DiscoveryCandidate | null>;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export interface DiscoveryBudget {
  maxProviderRequests: number;
  maxCandidates: number;
  maxVerificationRequests: number;
  maxCrawlPages: number;
  maxAiCalls: number;
  maxExecutionMinutes: number;
}

export interface ProviderStat {
  requestCount: number;
  resultCount: number;
  newCandidateCount: number;
  duplicateCount: number;
  verifiedCount: number;
  failedCount: number;
  skipped: boolean;
  unavailableReason?: string;
}

export type ProviderStats = Partial<Record<DiscoveryProviderName, ProviderStat>>;

export interface BudgetUsage {
  providerRequests: number;
  candidates: number;
  verificationRequests: number;
  startedAt: number;
}

/** 予算の消費を追跡し、超過時に処理を止める */
export interface BudgetTracker {
  readonly budget: DiscoveryBudget;
  readonly usage: BudgetUsage;
  canProviderRequest(): boolean;
  canVerificationRequest(): boolean;
  canAddCandidate(): boolean;
  isTimeExceeded(): boolean;
  consumeProviderRequest(): void;
  consumeVerificationRequest(): void;
  addCandidates(n: number): void;
  /** 予算が尽きた理由。まだ余裕があれば null */
  exhaustedReason(): string | null;
}

export type DiscoveryRunStatus = "pending" | "running" | "completed" | "partially_completed" | "failed" | "cancelled";
export type DiscoveryCandidateStatus = "discovered" | "verifying" | "verified" | "needs_review" | "duplicate" | "rejected" | "failed";
export type DiscoveryMode = "gbiz" | "places" | "search" | "hybrid";
