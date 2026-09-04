/**
 * Drizzle スキーマ（Neon PostgreSQL）
 * 旧 Supabase migration (0001_init.sql) のテーブル定義をそのまま移植。
 * プロパティ名は DB カラム名と同じ snake_case にし、$inferSelect の型が
 * 既存 UI / ビジネスロジックの Row 型と一致するようにしている。
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
const tsNow = (name: string) => ts(name).notNull().defaultNow();
const jsonArray = (name: string) => jsonb(name).$type<Json>().notNull().default(sql`'[]'::jsonb`);
const jsonObject = (name: string) => jsonb(name).$type<Json>().notNull().default(sql`'{}'::jsonb`);

// =============================================================
// 企業情報
// =============================================================
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    corporate_number: text("corporate_number"),
    company_name: text("company_name").notNull(),
    company_name_kana: text("company_name_kana"),
    company_name_normalized: text("company_name_normalized").notNull(),
    prefecture: text("prefecture"),
    city: text("city"),
    address: text("address"),
    address_normalized: text("address_normalized"),
    postal_code: text("postal_code"),
    industry: text("industry"),
    industry_detail: text("industry_detail"),
    employee_count: integer("employee_count"),
    employee_range: text("employee_range"),
    capital: bigint("capital", { mode: "number" }),
    established_date: date("established_date"),
    representative_name: text("representative_name"),
    phone: text("phone"),
    email: text("email"),
    description: text("description"),
    website_url: text("website_url"),
    website_domain: text("website_domain"),
    website_candidates: jsonArray("website_candidates"),
    contact_page_url: text("contact_page_url"),
    contact_form_url: text("contact_form_url"),
    recruit_page_url: text("recruit_page_url"),
    instagram_url: text("instagram_url"),
    facebook_url: text("facebook_url"),
    x_url: text("x_url"),
    youtube_url: text("youtube_url"),
    linkedin_url: text("linkedin_url"),
    tiktok_url: text("tiktok_url"),
    source: text("source").$type<CompanySource>().notNull().default("manual"),
    source_raw: jsonb("source_raw").$type<Json>(),
    official_site_confidence: integer("official_site_confidence"),
    verification_status: text("verification_status").$type<VerificationStatus>().notNull().default("unverified"),
    sales_contact_allowed: text("sales_contact_allowed").$type<SalesContactAllowed>().notNull().default("unknown"),
    sales_restriction_text: text("sales_restriction_text"),
    sales_restriction_source_url: text("sales_restriction_source_url"),
    latest_analysis_id: uuid("latest_analysis_id").references((): AnyPgColumn => companyAnalysis.id, { onDelete: "set null" }),
    crawl_status: text("crawl_status").$type<CrawlStatus>().notNull().default("not_crawled"),
    analysis_status: text("analysis_status").$type<AnalysisStatus>().notNull().default("not_analyzed"),
    notes: text("notes"),
    // Neon Auth のユーザーIDは文字列のため text
    created_by: text("created_by"),
    created_at: tsNow("created_at"),
    updated_at: tsNow("updated_at"),
    last_crawled_at: ts("last_crawled_at"),
    last_analyzed_at: ts("last_analyzed_at"),
  },
  (t) => [
    // 重複防止（優先順位: 法人番号 > ドメイン > 企業名+所在地）
    uniqueIndex("companies_corporate_number_key").on(t.corporate_number).where(sql`corporate_number is not null`),
    uniqueIndex("companies_website_domain_key").on(t.website_domain).where(sql`website_domain is not null`),
    uniqueIndex("companies_name_address_key").on(t.company_name_normalized, t.address_normalized).where(sql`address_normalized is not null`),
    index("companies_name_normalized_idx").on(t.company_name_normalized),
    index("companies_prefecture_idx").on(t.prefecture),
    index("companies_industry_idx").on(t.industry),
    index("companies_created_at_idx").on(t.created_at.desc()),
    index("companies_sales_contact_idx").on(t.sales_contact_allowed),
    check("companies_source_check", sql`${t.source} in ('gbiz','google_places','manual','import','mock')`),
    check("companies_verification_status_check", sql`${t.verification_status} in ('unverified','needs_review','verified','manual','no_website')`),
    check("companies_sales_contact_allowed_check", sql`${t.sales_contact_allowed} in ('true','false','unknown')`),
    check("companies_crawl_status_check", sql`${t.crawl_status} in ('not_crawled','crawling','crawled','failed','no_website')`),
    check("companies_analysis_status_check", sql`${t.analysis_status} in ('not_analyzed','analyzing','analyzed','failed')`),
    check("companies_official_site_confidence_check", sql`${t.official_site_confidence} between 0 and 100`),
  ],
);

// =============================================================
// クロール済みページ
// =============================================================
export const companyPages = pgTable(
  "company_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    page_type: text("page_type").notNull().default("other"),
    title: text("title"),
    raw_text: text("raw_text"),
    summary: text("summary"),
    http_status: integer("http_status"),
    text_length: integer("text_length"),
    crawled_at: tsNow("crawled_at"),
  },
  (t) => [uniqueIndex("company_pages_company_id_url_key").on(t.company_id, t.url), index("company_pages_company_idx").on(t.company_id)],
);

// =============================================================
// AI 企業分析
// =============================================================
export const companyAnalysis = pgTable(
  "company_analysis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    company_summary: text("company_summary"),
    business_summary: text("business_summary"),
    recruiting_status: text("recruiting_status").$type<RecruitingStatus>().notNull().default("unknown"),
    recruiting_summary: text("recruiting_summary"),
    target_candidates: text("target_candidates").array().notNull().default(sql`'{}'::text[]`),
    new_graduate_hiring: text("new_graduate_hiring").$type<YesNoUnknown>().notNull().default("unknown"),
    mid_career_hiring: text("mid_career_hiring").$type<YesNoUnknown>().notNull().default("unknown"),
    recruitment_page_quality_score: integer("recruitment_page_quality_score"),
    recruitment_issue_score: integer("recruitment_issue_score"),
    web_quality_score: integer("web_quality_score"),
    sns_activity_score: integer("sns_activity_score"),
    digital_marketing_score: integer("digital_marketing_score"),
    dx_opportunity_score: integer("dx_opportunity_score"),
    growth_potential_score: integer("growth_potential_score"),
    sales_priority_score: integer("sales_priority_score"),
    sales_priority_rank: text("sales_priority_rank").$type<SalesRank>(),
    detected_issues: jsonArray("detected_issues"),
    detected_strengths: jsonArray("detected_strengths"),
    recommended_topics: jsonArray("recommended_topics"),
    observed_facts: jsonArray("observed_facts"),
    inferences: jsonArray("inferences"),
    analysis_reason: text("analysis_reason"),
    confidence_score: integer("confidence_score"),
    model: text("model"),
    provider: text("provider").notNull().default("anthropic"),
    input_tokens: integer("input_tokens"),
    output_tokens: integer("output_tokens"),
    analyzed_at: tsNow("analyzed_at"),
    created_at: tsNow("created_at"),
  },
  (t) => [
    index("company_analysis_company_idx").on(t.company_id, t.analyzed_at.desc()),
    check("company_analysis_recruiting_status_check", sql`${t.recruiting_status} in ('active','inactive','unknown')`),
    check("company_analysis_new_graduate_hiring_check", sql`${t.new_graduate_hiring} in ('yes','no','unknown')`),
    check("company_analysis_mid_career_hiring_check", sql`${t.mid_career_hiring} in ('yes','no','unknown')`),
    check("company_analysis_sales_priority_rank_check", sql`${t.sales_priority_rank} in ('A','B','C','D')`),
    check("company_analysis_scores_range_check", sql`
      ${t.recruitment_page_quality_score} between 0 and 100 and ${t.recruitment_issue_score} between 0 and 100
      and ${t.web_quality_score} between 0 and 100 and ${t.sns_activity_score} between 0 and 100
      and ${t.digital_marketing_score} between 0 and 100 and ${t.dx_opportunity_score} between 0 and 100
      and ${t.growth_potential_score} between 0 and 100 and ${t.sales_priority_score} between 0 and 100
      and ${t.confidence_score} between 0 and 100`),
  ],
);

export const companyAnalysisEvidence = pgTable(
  "company_analysis_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    analysis_id: uuid("analysis_id").notNull().references(() => companyAnalysis.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    source_url: text("source_url"),
    source_title: text("source_title"),
    evidence_text: text("evidence_text").notNull(),
    created_at: tsNow("created_at"),
  },
  (t) => [index("company_analysis_evidence_analysis_idx").on(t.analysis_id)],
);

// =============================================================
// ジョブキュー
// =============================================================
const jobStatusCheck = (name: string, col: AnyPgColumn) => check(name, sql`${col} in ('pending','processing','completed','failed','retrying','cancelled')`);

export const searchJobs = pgTable(
  "search_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name"),
    conditions: jsonb("conditions").$type<Json>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("pending"),
    requested_count: integer("requested_count").notNull().default(100),
    found_count: integer("found_count").notNull().default(0),
    registered_count: integer("registered_count").notNull().default(0),
    new_count: integer("new_count").notNull().default(0),
    duplicate_count: integer("duplicate_count").notNull().default(0),
    skipped_count: integer("skipped_count").notNull().default(0),
    failed_count: integer("failed_count").notNull().default(0),
    cursor: jsonObject("cursor"),
    attempts: integer("attempts").notNull().default(0),
    max_attempts: integer("max_attempts").notNull().default(3),
    error: text("error"),
    provider: text("provider"),
    created_by: text("created_by"),
    locked_at: ts("locked_at"),
    started_at: ts("started_at"),
    completed_at: ts("completed_at"),
    created_at: tsNow("created_at"),
    updated_at: tsNow("updated_at"),
  },
  (t) => [index("search_jobs_status_idx").on(t.status, t.created_at), jobStatusCheck("search_jobs_status_check", t.status)],
);

export const searchJobItems = pgTable(
  "search_job_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    search_job_id: uuid("search_job_id").notNull().references(() => searchJobs.id, { onDelete: "cascade" }),
    company_id: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    corporate_number: text("corporate_number"),
    company_name: text("company_name").notNull(),
    status: text("status").$type<SearchJobItemStatus>().notNull(),
    reason: text("reason"),
    created_at: tsNow("created_at"),
  },
  (t) => [index("search_job_items_job_idx").on(t.search_job_id), check("search_job_items_status_check", sql`${t.status} in ('new','duplicate','skipped','failed')`)],
);

export const crawlJobs = pgTable(
  "crawl_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    search_job_id: uuid("search_job_id").references(() => searchJobs.id, { onDelete: "set null" }),
    status: text("status").$type<JobStatus>().notNull().default("pending"),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    max_attempts: integer("max_attempts").notNull().default(3),
    error: text("error"),
    result: jsonb("result").$type<Json>(),
    enqueue_analysis: boolean("enqueue_analysis").notNull().default(true),
    locked_at: ts("locked_at"),
    started_at: ts("started_at"),
    completed_at: ts("completed_at"),
    created_at: tsNow("created_at"),
    updated_at: tsNow("updated_at"),
  },
  (t) => [
    index("crawl_jobs_status_idx").on(t.status, t.priority.desc(), t.created_at),
    index("crawl_jobs_company_idx").on(t.company_id),
    jobStatusCheck("crawl_jobs_status_check", t.status),
  ],
);

export const analysisJobs = pgTable(
  "analysis_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    search_job_id: uuid("search_job_id").references(() => searchJobs.id, { onDelete: "set null" }),
    status: text("status").$type<JobStatus>().notNull().default("pending"),
    priority: integer("priority").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    max_attempts: integer("max_attempts").notNull().default(3),
    error: text("error"),
    result: jsonb("result").$type<Json>(),
    locked_at: ts("locked_at"),
    started_at: ts("started_at"),
    completed_at: ts("completed_at"),
    created_at: tsNow("created_at"),
    updated_at: tsNow("updated_at"),
  },
  (t) => [
    index("analysis_jobs_status_idx").on(t.status, t.priority.desc(), t.created_at),
    index("analysis_jobs_company_idx").on(t.company_id),
    jobStatusCheck("analysis_jobs_status_check", t.status),
  ],
);

// =============================================================
// ログ
// =============================================================
export const systemLogs = pgTable(
  "system_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    level: text("level").$type<LogLevel>().notNull(),
    category: text("category").notNull(),
    message: text("message").notNull(),
    meta: jsonb("meta").$type<Json>(),
    company_id: uuid("company_id"),
    job_id: uuid("job_id"),
    job_type: text("job_type"),
    created_at: tsNow("created_at"),
  },
  (t) => [
    index("system_logs_created_idx").on(t.created_at.desc()),
    index("system_logs_category_idx").on(t.category, t.created_at.desc()),
    check("system_logs_level_check", sql`${t.level} in ('debug','info','warn','error')`),
  ],
);

export const aiUsageLogs = pgTable(
  "ai_usage_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    company_id: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    analysis_id: uuid("analysis_id").references(() => companyAnalysis.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    provider: text("provider").notNull().default("anthropic"),
    model: text("model").notNull(),
    input_tokens: integer("input_tokens").notNull().default(0),
    output_tokens: integer("output_tokens").notNull().default(0),
    cache_read_tokens: integer("cache_read_tokens").notNull().default(0),
    cache_creation_tokens: integer("cache_creation_tokens").notNull().default(0),
    duration_ms: integer("duration_ms"),
    success: boolean("success").notNull().default(true),
    error: text("error"),
    created_at: tsNow("created_at"),
  },
  (t) => [index("ai_usage_logs_created_idx").on(t.created_at.desc())],
);

// =============================================================
// 将来用テーブル（Phase 4 以降）。空でもシステムは動作する。
// =============================================================
export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category"),
  description: text("description"),
  target_issues: jsonArray("target_issues"),
  pitch_points: jsonArray("pitch_points"),
  price_range: text("price_range"),
  is_active: boolean("is_active").notNull().default(true),
  created_at: tsNow("created_at"),
  updated_at: tsNow("updated_at"),
});

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name"),
    role: text("role"),
    email: text("email"),
    phone: text("phone"),
    source: text("source"),
    source_url: text("source_url"),
    is_primary: boolean("is_primary").notNull().default(false),
    created_at: tsNow("created_at"),
    updated_at: tsNow("updated_at"),
  },
  (t) => [index("contacts_company_idx").on(t.company_id)],
);

/** 営業拒否 / 配信停止 / 送信禁止 / 返信不要 の抑止リスト */
export const suppressionList = pgTable(
  "suppression_list",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    email: text("email"),
    domain: text("domain"),
    reason: text("reason").$type<SuppressionReason>().notNull(),
    note: text("note"),
    source_url: text("source_url"),
    created_by: text("created_by"),
    created_at: tsNow("created_at"),
  },
  (t) => [
    index("suppression_list_company_idx").on(t.company_id),
    index("suppression_list_email_idx").on(sql`lower(${t.email})`),
    index("suppression_list_domain_idx").on(t.domain),
    check("suppression_list_reason_check", sql`${t.reason} in ('sales_restriction_detected','unsubscribed','do_not_contact','no_reply_needed','bounced','manual')`),
    check("suppression_list_target_check", sql`${t.company_id} is not null or ${t.email} is not null or ${t.domain} is not null`),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    service_id: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    status: text("status").notNull().default("draft"),
    target_filter: jsonObject("target_filter"),
    created_by: text("created_by"),
    created_at: tsNow("created_at"),
    updated_at: tsNow("updated_at"),
  },
  (t) => [check("campaigns_status_check", sql`${t.status} in ('draft','active','paused','completed')`)],
);

export const emailTemplates = pgTable("email_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  service_id: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
  subject_template: text("subject_template").notNull(),
  body_template: text("body_template").notNull(),
  is_active: boolean("is_active").notNull().default(true),
  created_at: tsNow("created_at"),
  updated_at: tsNow("updated_at"),
});

export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    contact_id: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    campaign_id: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    template_id: uuid("template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
    service_id: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
    direction: text("direction").notNull().default("outbound"),
    to_email: text("to_email"),
    from_email: text("from_email"),
    subject: text("subject"),
    body: text("body"),
    status: text("status").notNull().default("draft"),
    provider_message_id: text("provider_message_id"),
    thread_id: text("thread_id"),
    sent_at: ts("sent_at"),
    created_at: tsNow("created_at"),
    updated_at: tsNow("updated_at"),
  },
  (t) => [
    index("email_messages_company_idx").on(t.company_id),
    check("email_messages_direction_check", sql`${t.direction} in ('outbound','inbound')`),
    check("email_messages_status_check", sql`${t.status} in ('draft','approved','queued','sent','failed','bounced','cancelled')`),
  ],
);

export const emailReplies = pgTable("email_replies", {
  id: uuid("id").primaryKey().defaultRandom(),
  message_id: uuid("message_id").references(() => emailMessages.id, { onDelete: "set null" }),
  company_id: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  from_email: text("from_email"),
  subject: text("subject"),
  body: text("body"),
  classification: text("classification"),
  received_at: tsNow("received_at"),
  created_at: tsNow("created_at"),
});

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    company_id: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title"),
    body: text("body"),
    meta: jsonb("meta").$type<Json>(),
    actor_id: text("actor_id"),
    occurred_at: tsNow("occurred_at"),
    created_at: tsNow("created_at"),
  },
  (t) => [index("activities_company_idx").on(t.company_id, t.occurred_at.desc())],
);

// =============================================================
// 一覧用ビュー: 企業 + 最新分析をフラット化（定義は drizzle/ の custom migration）
// =============================================================
export const companyOverview = pgView("company_overview", {
  id: uuid("id").notNull(),
  corporate_number: text("corporate_number"),
  company_name: text("company_name").notNull(),
  company_name_kana: text("company_name_kana"),
  prefecture: text("prefecture"),
  city: text("city"),
  address: text("address"),
  industry: text("industry"),
  industry_detail: text("industry_detail"),
  employee_count: integer("employee_count"),
  employee_range: text("employee_range"),
  phone: text("phone"),
  email: text("email"),
  website_url: text("website_url"),
  website_domain: text("website_domain"),
  contact_page_url: text("contact_page_url"),
  contact_form_url: text("contact_form_url"),
  recruit_page_url: text("recruit_page_url"),
  instagram_url: text("instagram_url"),
  facebook_url: text("facebook_url"),
  x_url: text("x_url"),
  youtube_url: text("youtube_url"),
  linkedin_url: text("linkedin_url"),
  tiktok_url: text("tiktok_url"),
  source: text("source").$type<CompanySource>().notNull(),
  official_site_confidence: integer("official_site_confidence"),
  verification_status: text("verification_status").$type<VerificationStatus>().notNull(),
  sales_contact_allowed: text("sales_contact_allowed").$type<SalesContactAllowed>().notNull(),
  crawl_status: text("crawl_status").$type<CrawlStatus>().notNull(),
  analysis_status: text("analysis_status").$type<AnalysisStatus>().notNull(),
  created_at: ts("created_at").notNull(),
  updated_at: ts("updated_at").notNull(),
  last_crawled_at: ts("last_crawled_at"),
  last_analyzed_at: ts("last_analyzed_at"),
  has_website: boolean("has_website").notNull(),
  has_recruit_page: boolean("has_recruit_page").notNull(),
  has_contact: boolean("has_contact").notNull(),
  has_email: boolean("has_email").notNull(),
  has_sns: boolean("has_sns").notNull(),
  analysis_id: uuid("analysis_id"),
  recruiting_status: text("recruiting_status").$type<RecruitingStatus>(),
  new_graduate_hiring: text("new_graduate_hiring").$type<YesNoUnknown>(),
  mid_career_hiring: text("mid_career_hiring").$type<YesNoUnknown>(),
  recruitment_page_quality_score: integer("recruitment_page_quality_score"),
  recruitment_issue_score: integer("recruitment_issue_score"),
  web_quality_score: integer("web_quality_score"),
  sns_activity_score: integer("sns_activity_score"),
  digital_marketing_score: integer("digital_marketing_score"),
  dx_opportunity_score: integer("dx_opportunity_score"),
  growth_potential_score: integer("growth_potential_score"),
  sales_priority_score: integer("sales_priority_score"),
  sales_priority_rank: text("sales_priority_rank").$type<SalesRank>(),
  confidence_score: integer("confidence_score"),
  analyzed_at: ts("analyzed_at"),
}).existing();

// =============================================================
// 列挙型（文字列リテラル）
// =============================================================
export type CompanySource = "gbiz" | "google_places" | "manual" | "import" | "mock";
export type VerificationStatus = "unverified" | "needs_review" | "verified" | "manual" | "no_website";
export type SalesContactAllowed = "true" | "false" | "unknown";
export type CrawlStatus = "not_crawled" | "crawling" | "crawled" | "failed" | "no_website";
export type AnalysisStatus = "not_analyzed" | "analyzing" | "analyzed" | "failed";
export type JobStatus = "pending" | "processing" | "completed" | "failed" | "retrying" | "cancelled";
export type SearchJobItemStatus = "new" | "duplicate" | "skipped" | "failed";
export type SalesRank = "A" | "B" | "C" | "D";
export type YesNoUnknown = "yes" | "no" | "unknown";
export type RecruitingStatus = "active" | "inactive" | "unknown";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type SuppressionReason = "sales_restriction_detected" | "unsubscribed" | "do_not_contact" | "no_reply_needed" | "bounced" | "manual";
