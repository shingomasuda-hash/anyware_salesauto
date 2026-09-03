/**
 * Supabase Database 型定義（supabase/migrations/0001_init.sql と対応）
 * supabase-js の Generic に渡すため、Row / Insert / Update を各テーブルで定義する。
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type WithDefaults<Row, Required extends keyof Row> = Pick<Row, Required> & Partial<Omit<Row, Required>>;
type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};
type TableDef<Row, Required extends keyof Row = never, Rels extends Relationship[] = []> = {
  Row: Row;
  Insert: WithDefaults<Row, Required>;
  Update: Partial<Row>;
  Relationships: Rels;
};
type CompanyRel<FK extends string> = [{ foreignKeyName: FK; columns: ["company_id"]; isOneToOne: false; referencedRelation: "companies"; referencedColumns: ["id"] }];

export type CompanySource = "gbiz" | "google_places" | "manual" | "import" | "mock";
export type VerificationStatus = "unverified" | "needs_review" | "verified" | "manual" | "no_website";
export type SalesContactAllowed = "true" | "false" | "unknown";
export type CrawlStatus = "not_crawled" | "crawling" | "crawled" | "failed" | "no_website";
export type AnalysisStatus = "not_analyzed" | "analyzing" | "analyzed" | "failed";
export type JobStatus = "pending" | "processing" | "completed" | "failed" | "retrying" | "cancelled";
export type SalesRank = "A" | "B" | "C" | "D";
export type YesNoUnknown = "yes" | "no" | "unknown";
export type RecruitingStatus = "active" | "inactive" | "unknown";
export type SuppressionReason =
  | "sales_restriction_detected"
  | "unsubscribed"
  | "do_not_contact"
  | "no_reply_needed"
  | "bounced"
  | "manual";

export type CompanyRow = {
  id: string;
  corporate_number: string | null;
  company_name: string;
  company_name_kana: string | null;
  company_name_normalized: string;
  prefecture: string | null;
  city: string | null;
  address: string | null;
  address_normalized: string | null;
  postal_code: string | null;
  industry: string | null;
  industry_detail: string | null;
  employee_count: number | null;
  employee_range: string | null;
  capital: number | null;
  established_date: string | null;
  representative_name: string | null;
  phone: string | null;
  email: string | null;
  description: string | null;
  website_url: string | null;
  website_domain: string | null;
  website_candidates: Json;
  contact_page_url: string | null;
  contact_form_url: string | null;
  recruit_page_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  x_url: string | null;
  youtube_url: string | null;
  linkedin_url: string | null;
  tiktok_url: string | null;
  source: CompanySource;
  source_raw: Json | null;
  official_site_confidence: number | null;
  verification_status: VerificationStatus;
  sales_contact_allowed: SalesContactAllowed;
  sales_restriction_text: string | null;
  sales_restriction_source_url: string | null;
  latest_analysis_id: string | null;
  crawl_status: CrawlStatus;
  analysis_status: AnalysisStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_crawled_at: string | null;
  last_analyzed_at: string | null;
}

export type CompanyPageRow = {
  id: string;
  company_id: string;
  url: string;
  page_type: string;
  title: string | null;
  raw_text: string | null;
  summary: string | null;
  http_status: number | null;
  text_length: number | null;
  crawled_at: string;
}

export type CompanyAnalysisRow = {
  id: string;
  company_id: string;
  company_summary: string | null;
  business_summary: string | null;
  recruiting_status: RecruitingStatus;
  recruiting_summary: string | null;
  target_candidates: string[];
  new_graduate_hiring: YesNoUnknown;
  mid_career_hiring: YesNoUnknown;
  recruitment_page_quality_score: number | null;
  recruitment_issue_score: number | null;
  web_quality_score: number | null;
  sns_activity_score: number | null;
  digital_marketing_score: number | null;
  dx_opportunity_score: number | null;
  growth_potential_score: number | null;
  sales_priority_score: number | null;
  sales_priority_rank: SalesRank | null;
  detected_issues: Json;
  detected_strengths: Json;
  recommended_topics: Json;
  observed_facts: Json;
  inferences: Json;
  analysis_reason: string | null;
  confidence_score: number | null;
  model: string | null;
  provider: string;
  input_tokens: number | null;
  output_tokens: number | null;
  analyzed_at: string;
  created_at: string;
}

export type CompanyAnalysisEvidenceRow = {
  id: string;
  company_id: string;
  analysis_id: string;
  category: string;
  source_url: string | null;
  source_title: string | null;
  evidence_text: string;
  created_at: string;
}

export type SearchJobRow = {
  id: string;
  name: string | null;
  conditions: Json;
  status: JobStatus;
  requested_count: number;
  found_count: number;
  registered_count: number;
  new_count: number;
  duplicate_count: number;
  skipped_count: number;
  failed_count: number;
  cursor: Json;
  attempts: number;
  max_attempts: number;
  error: string | null;
  provider: string | null;
  created_by: string | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SearchJobItemRow = {
  id: string;
  search_job_id: string;
  company_id: string | null;
  corporate_number: string | null;
  company_name: string;
  status: "new" | "duplicate" | "skipped" | "failed";
  reason: string | null;
  created_at: string;
}

export type CrawlJobRow = {
  id: string;
  company_id: string;
  search_job_id: string | null;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  error: string | null;
  result: Json | null;
  enqueue_analysis: boolean;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AnalysisJobRow = {
  id: string;
  company_id: string;
  search_job_id: string | null;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  error: string | null;
  result: Json | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SystemLogRow = {
  id: number;
  level: "debug" | "info" | "warn" | "error";
  category: string;
  message: string;
  meta: Json | null;
  company_id: string | null;
  job_id: string | null;
  job_type: string | null;
  created_at: string;
}

export type AiUsageLogRow = {
  id: number;
  company_id: string | null;
  analysis_id: string | null;
  purpose: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  duration_ms: number | null;
  success: boolean;
  error: string | null;
  created_at: string;
}

export type ServiceRow = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  target_issues: Json;
  pitch_points: Json;
  price_range: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ContactRow = {
  id: string;
  company_id: string;
  name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  source_url: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export type SuppressionListRow = {
  id: string;
  company_id: string | null;
  email: string | null;
  domain: string | null;
  reason: SuppressionReason;
  note: string | null;
  source_url: string | null;
  created_by: string | null;
  created_at: string;
}

export type CampaignRow = {
  id: string;
  name: string;
  service_id: string | null;
  status: "draft" | "active" | "paused" | "completed";
  target_filter: Json;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type EmailTemplateRow = {
  id: string;
  name: string;
  service_id: string | null;
  subject_template: string;
  body_template: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type EmailMessageRow = {
  id: string;
  company_id: string;
  contact_id: string | null;
  campaign_id: string | null;
  template_id: string | null;
  service_id: string | null;
  direction: "outbound" | "inbound";
  to_email: string | null;
  from_email: string | null;
  subject: string | null;
  body: string | null;
  status: "draft" | "approved" | "queued" | "sent" | "failed" | "bounced" | "cancelled";
  provider_message_id: string | null;
  thread_id: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export type EmailReplyRow = {
  id: string;
  message_id: string | null;
  company_id: string | null;
  from_email: string | null;
  subject: string | null;
  body: string | null;
  classification: string | null;
  received_at: string;
  created_at: string;
}

export type ActivityRow = {
  id: string;
  company_id: string;
  type: string;
  title: string | null;
  body: string | null;
  meta: Json | null;
  actor_id: string | null;
  occurred_at: string;
  created_at: string;
}

/** company_overview ビュー（企業 + 最新分析のフラット化） */
export type CompanyOverviewRow = {
  id: string;
  corporate_number: string | null;
  company_name: string;
  company_name_kana: string | null;
  prefecture: string | null;
  city: string | null;
  address: string | null;
  industry: string | null;
  industry_detail: string | null;
  employee_count: number | null;
  employee_range: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  website_domain: string | null;
  contact_page_url: string | null;
  contact_form_url: string | null;
  recruit_page_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  x_url: string | null;
  youtube_url: string | null;
  linkedin_url: string | null;
  tiktok_url: string | null;
  source: CompanySource;
  official_site_confidence: number | null;
  verification_status: VerificationStatus;
  sales_contact_allowed: SalesContactAllowed;
  crawl_status: CrawlStatus;
  analysis_status: AnalysisStatus;
  created_at: string;
  updated_at: string;
  last_crawled_at: string | null;
  last_analyzed_at: string | null;
  has_website: boolean;
  has_recruit_page: boolean;
  has_contact: boolean;
  has_email: boolean;
  has_sns: boolean;
  analysis_id: string | null;
  recruiting_status: RecruitingStatus | null;
  new_graduate_hiring: YesNoUnknown | null;
  mid_career_hiring: YesNoUnknown | null;
  recruitment_page_quality_score: number | null;
  recruitment_issue_score: number | null;
  web_quality_score: number | null;
  sns_activity_score: number | null;
  digital_marketing_score: number | null;
  dx_opportunity_score: number | null;
  growth_potential_score: number | null;
  sales_priority_score: number | null;
  sales_priority_rank: SalesRank | null;
  confidence_score: number | null;
  analyzed_at: string | null;
}

export type DashboardStats = {
  total_companies: number;
  added_this_week: number;
  rank_a: number;
  rank_b: number;
  unanalyzed: number;
  sales_restricted: number;
  website_unverified: number;
  pending_jobs: number;
}

export type Database = {
  __InternalSupabase: { PostgrestVersion: "13" };
  public: {
    Tables: {
      companies: TableDef<CompanyRow, "company_name" | "company_name_normalized">;
      company_pages: TableDef<CompanyPageRow, "company_id" | "url", CompanyRel<"company_pages_company_id_fkey">>;
      company_analysis: TableDef<CompanyAnalysisRow, "company_id", CompanyRel<"company_analysis_company_id_fkey">>;
      company_analysis_evidence: TableDef<CompanyAnalysisEvidenceRow, "company_id" | "analysis_id" | "category" | "evidence_text">;
      search_jobs: TableDef<SearchJobRow, "conditions">;
      search_job_items: TableDef<SearchJobItemRow, "search_job_id" | "company_name" | "status", CompanyRel<"search_job_items_company_id_fkey">>;
      crawl_jobs: TableDef<CrawlJobRow, "company_id", CompanyRel<"crawl_jobs_company_id_fkey">>;
      analysis_jobs: TableDef<AnalysisJobRow, "company_id", CompanyRel<"analysis_jobs_company_id_fkey">>;
      system_logs: TableDef<SystemLogRow, "level" | "category" | "message">;
      ai_usage_logs: TableDef<AiUsageLogRow, "purpose" | "model", CompanyRel<"ai_usage_logs_company_id_fkey">>;
      services: TableDef<ServiceRow, "name">;
      contacts: TableDef<ContactRow, "company_id">;
      suppression_list: TableDef<SuppressionListRow, "reason">;
      campaigns: TableDef<CampaignRow, "name">;
      email_templates: TableDef<EmailTemplateRow, "name" | "subject_template" | "body_template">;
      email_messages: TableDef<EmailMessageRow, "company_id">;
      email_replies: TableDef<EmailReplyRow, never>;
      activities: TableDef<ActivityRow, "company_id" | "type">;
    };
    Views: {
      company_overview: { Row: CompanyOverviewRow; Relationships: [] };
    };
    Functions: {
      claim_job: { Args: { p_job_table: string; p_stale_minutes?: number }; Returns: Json };
      increment_search_job_counters: {
        Args: {
          p_job_id: string;
          p_found?: number;
          p_registered?: number;
          p_new?: number;
          p_duplicate?: number;
          p_skipped?: number;
          p_failed?: number;
        };
        Returns: undefined;
      };
      dashboard_stats: { Args: Record<string, never>; Returns: Json };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
