/**
 * Row 型（Drizzle スキーマから導出）。
 * 旧 Supabase の Database 型と同じ名前で公開し、UI / ビジネスロジックの変更を最小化する。
 */
import type * as s from "./schema";

export type {
  Json,
  CompanySource,
  VerificationStatus,
  SalesContactAllowed,
  CrawlStatus,
  AnalysisStatus,
  JobStatus,
  SearchJobItemStatus,
  SalesRank,
  YesNoUnknown,
  RecruitingStatus,
  LogLevel,
  SuppressionReason,
} from "./schema";

export type CompanyRow = typeof s.companies.$inferSelect;
export type CompanyInsert = typeof s.companies.$inferInsert;
export type CompanyPageRow = typeof s.companyPages.$inferSelect;
export type CompanyPageInsert = typeof s.companyPages.$inferInsert;
export type CompanyAnalysisRow = typeof s.companyAnalysis.$inferSelect;
export type CompanyAnalysisInsert = typeof s.companyAnalysis.$inferInsert;
export type CompanyAnalysisEvidenceRow = typeof s.companyAnalysisEvidence.$inferSelect;
export type CompanyAnalysisEvidenceInsert = typeof s.companyAnalysisEvidence.$inferInsert;
export type SearchJobRow = typeof s.searchJobs.$inferSelect;
export type SearchJobItemRow = typeof s.searchJobItems.$inferSelect;
export type CrawlJobRow = typeof s.crawlJobs.$inferSelect;
export type AnalysisJobRow = typeof s.analysisJobs.$inferSelect;
export type SystemLogRow = typeof s.systemLogs.$inferSelect;
export type AiUsageLogRow = typeof s.aiUsageLogs.$inferSelect;
export type AiUsageLogInsert = typeof s.aiUsageLogs.$inferInsert;
export type SuppressionListRow = typeof s.suppressionList.$inferSelect;
export type ServiceRow = typeof s.services.$inferSelect;
export type ContactRow = typeof s.contacts.$inferSelect;
export type CampaignRow = typeof s.campaigns.$inferSelect;
export type EmailTemplateRow = typeof s.emailTemplates.$inferSelect;
export type EmailMessageRow = typeof s.emailMessages.$inferSelect;
export type EmailReplyRow = typeof s.emailReplies.$inferSelect;
export type ActivityRow = typeof s.activities.$inferSelect;
export type CompanyOverviewRow = typeof s.companyOverview.$inferSelect;

export interface DashboardStats {
  total_companies: number;
  added_this_week: number;
  rank_a: number;
  rank_b: number;
  unanalyzed: number;
  sales_restricted: number;
  website_unverified: number;
  pending_jobs: number;
}
