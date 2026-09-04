CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"body" text,
	"meta" jsonb,
	"actor_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_usage_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"company_id" uuid,
	"analysis_id" uuid,
	"purpose" text NOT NULL,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"success" boolean DEFAULT true NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"search_job_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"result" jsonb,
	"locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_jobs_status_check" CHECK ("analysis_jobs"."status" in ('pending','processing','completed','failed','retrying','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"service_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"target_filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_status_check" CHECK ("campaigns"."status" in ('draft','active','paused','completed'))
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corporate_number" text,
	"company_name" text NOT NULL,
	"company_name_kana" text,
	"company_name_normalized" text NOT NULL,
	"prefecture" text,
	"city" text,
	"address" text,
	"address_normalized" text,
	"postal_code" text,
	"industry" text,
	"industry_detail" text,
	"employee_count" integer,
	"employee_range" text,
	"capital" bigint,
	"established_date" date,
	"representative_name" text,
	"phone" text,
	"email" text,
	"description" text,
	"website_url" text,
	"website_domain" text,
	"website_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contact_page_url" text,
	"contact_form_url" text,
	"recruit_page_url" text,
	"instagram_url" text,
	"facebook_url" text,
	"x_url" text,
	"youtube_url" text,
	"linkedin_url" text,
	"tiktok_url" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_raw" jsonb,
	"official_site_confidence" integer,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"sales_contact_allowed" text DEFAULT 'unknown' NOT NULL,
	"sales_restriction_text" text,
	"sales_restriction_source_url" text,
	"latest_analysis_id" uuid,
	"crawl_status" text DEFAULT 'not_crawled' NOT NULL,
	"analysis_status" text DEFAULT 'not_analyzed' NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_crawled_at" timestamp with time zone,
	"last_analyzed_at" timestamp with time zone,
	CONSTRAINT "companies_source_check" CHECK ("companies"."source" in ('gbiz','google_places','manual','import','mock')),
	CONSTRAINT "companies_verification_status_check" CHECK ("companies"."verification_status" in ('unverified','needs_review','verified','manual','no_website')),
	CONSTRAINT "companies_sales_contact_allowed_check" CHECK ("companies"."sales_contact_allowed" in ('true','false','unknown')),
	CONSTRAINT "companies_crawl_status_check" CHECK ("companies"."crawl_status" in ('not_crawled','crawling','crawled','failed','no_website')),
	CONSTRAINT "companies_analysis_status_check" CHECK ("companies"."analysis_status" in ('not_analyzed','analyzing','analyzed','failed')),
	CONSTRAINT "companies_official_site_confidence_check" CHECK ("companies"."official_site_confidence" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "company_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"company_summary" text,
	"business_summary" text,
	"recruiting_status" text DEFAULT 'unknown' NOT NULL,
	"recruiting_summary" text,
	"target_candidates" text[] DEFAULT '{}'::text[] NOT NULL,
	"new_graduate_hiring" text DEFAULT 'unknown' NOT NULL,
	"mid_career_hiring" text DEFAULT 'unknown' NOT NULL,
	"recruitment_page_quality_score" integer,
	"recruitment_issue_score" integer,
	"web_quality_score" integer,
	"sns_activity_score" integer,
	"digital_marketing_score" integer,
	"dx_opportunity_score" integer,
	"growth_potential_score" integer,
	"sales_priority_score" integer,
	"sales_priority_rank" text,
	"detected_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"detected_strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observed_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inferences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"analysis_reason" text,
	"confidence_score" integer,
	"model" text,
	"provider" text DEFAULT 'anthropic' NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_analysis_recruiting_status_check" CHECK ("company_analysis"."recruiting_status" in ('active','inactive','unknown')),
	CONSTRAINT "company_analysis_new_graduate_hiring_check" CHECK ("company_analysis"."new_graduate_hiring" in ('yes','no','unknown')),
	CONSTRAINT "company_analysis_mid_career_hiring_check" CHECK ("company_analysis"."mid_career_hiring" in ('yes','no','unknown')),
	CONSTRAINT "company_analysis_sales_priority_rank_check" CHECK ("company_analysis"."sales_priority_rank" in ('A','B','C','D')),
	CONSTRAINT "company_analysis_scores_range_check" CHECK (
      "company_analysis"."recruitment_page_quality_score" between 0 and 100 and "company_analysis"."recruitment_issue_score" between 0 and 100
      and "company_analysis"."web_quality_score" between 0 and 100 and "company_analysis"."sns_activity_score" between 0 and 100
      and "company_analysis"."digital_marketing_score" between 0 and 100 and "company_analysis"."dx_opportunity_score" between 0 and 100
      and "company_analysis"."growth_potential_score" between 0 and 100 and "company_analysis"."sales_priority_score" between 0 and 100
      and "company_analysis"."confidence_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "company_analysis_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"analysis_id" uuid NOT NULL,
	"category" text NOT NULL,
	"source_url" text,
	"source_title" text,
	"evidence_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"url" text NOT NULL,
	"page_type" text DEFAULT 'other' NOT NULL,
	"title" text,
	"raw_text" text,
	"summary" text,
	"http_status" integer,
	"text_length" integer,
	"crawled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text,
	"role" text,
	"email" text,
	"phone" text,
	"source" text,
	"source_url" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawl_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"search_job_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"result" jsonb,
	"enqueue_analysis" boolean DEFAULT true NOT NULL,
	"locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crawl_jobs_status_check" CHECK ("crawl_jobs"."status" in ('pending','processing','completed','failed','retrying','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"campaign_id" uuid,
	"template_id" uuid,
	"service_id" uuid,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"to_email" text,
	"from_email" text,
	"subject" text,
	"body" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"provider_message_id" text,
	"thread_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_messages_direction_check" CHECK ("email_messages"."direction" in ('outbound','inbound')),
	CONSTRAINT "email_messages_status_check" CHECK ("email_messages"."status" in ('draft','approved','queued','sent','failed','bounced','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "email_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid,
	"company_id" uuid,
	"from_email" text,
	"subject" text,
	"body" text,
	"classification" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"service_id" uuid,
	"subject_template" text NOT NULL,
	"body_template" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_job_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"search_job_id" uuid NOT NULL,
	"company_id" uuid,
	"corporate_number" text,
	"company_name" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_job_items_status_check" CHECK ("search_job_items"."status" in ('new','duplicate','skipped','failed'))
);
--> statement-breakpoint
CREATE TABLE "search_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"conditions" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_count" integer DEFAULT 100 NOT NULL,
	"found_count" integer DEFAULT 0 NOT NULL,
	"registered_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"provider" text,
	"created_by" text,
	"locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_jobs_status_check" CHECK ("search_jobs"."status" in ('pending','processing','completed','failed','retrying','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"description" text,
	"target_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pitch_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"price_range" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"email" text,
	"domain" text,
	"reason" text NOT NULL,
	"note" text,
	"source_url" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_list_reason_check" CHECK ("suppression_list"."reason" in ('sales_restriction_detected','unsubscribed','do_not_contact','no_reply_needed','bounced','manual')),
	CONSTRAINT "suppression_list_target_check" CHECK ("suppression_list"."company_id" is not null or "suppression_list"."email" is not null or "suppression_list"."domain" is not null)
);
--> statement-breakpoint
CREATE TABLE "system_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "system_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"level" text NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"meta" jsonb,
	"company_id" uuid,
	"job_id" uuid,
	"job_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_logs_level_check" CHECK ("system_logs"."level" in ('debug','info','warn','error'))
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_analysis_id_company_analysis_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."company_analysis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_search_job_id_search_jobs_id_fk" FOREIGN KEY ("search_job_id") REFERENCES "public"."search_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_latest_analysis_id_company_analysis_id_fk" FOREIGN KEY ("latest_analysis_id") REFERENCES "public"."company_analysis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_analysis" ADD CONSTRAINT "company_analysis_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_analysis_evidence" ADD CONSTRAINT "company_analysis_evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_analysis_evidence" ADD CONSTRAINT "company_analysis_evidence_analysis_id_company_analysis_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."company_analysis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_pages" ADD CONSTRAINT "company_pages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_search_job_id_search_jobs_id_fk" FOREIGN KEY ("search_job_id") REFERENCES "public"."search_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_message_id_email_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."email_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_replies" ADD CONSTRAINT "email_replies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_job_items" ADD CONSTRAINT "search_job_items_search_job_id_search_jobs_id_fk" FOREIGN KEY ("search_job_id") REFERENCES "public"."search_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_job_items" ADD CONSTRAINT "search_job_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_company_idx" ON "activities" USING btree ("company_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_usage_logs_created_idx" ON "ai_usage_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analysis_jobs_status_idx" ON "analysis_jobs" USING btree ("status","priority" DESC NULLS LAST,"created_at");--> statement-breakpoint
CREATE INDEX "analysis_jobs_company_idx" ON "analysis_jobs" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_corporate_number_key" ON "companies" USING btree ("corporate_number") WHERE corporate_number is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_website_domain_key" ON "companies" USING btree ("website_domain") WHERE website_domain is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_address_key" ON "companies" USING btree ("company_name_normalized","address_normalized") WHERE address_normalized is not null;--> statement-breakpoint
CREATE INDEX "companies_name_normalized_idx" ON "companies" USING btree ("company_name_normalized");--> statement-breakpoint
CREATE INDEX "companies_prefecture_idx" ON "companies" USING btree ("prefecture");--> statement-breakpoint
CREATE INDEX "companies_industry_idx" ON "companies" USING btree ("industry");--> statement-breakpoint
CREATE INDEX "companies_created_at_idx" ON "companies" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "companies_sales_contact_idx" ON "companies" USING btree ("sales_contact_allowed");--> statement-breakpoint
CREATE INDEX "company_analysis_company_idx" ON "company_analysis" USING btree ("company_id","analyzed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "company_analysis_evidence_analysis_idx" ON "company_analysis_evidence" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_pages_company_id_url_key" ON "company_pages" USING btree ("company_id","url");--> statement-breakpoint
CREATE INDEX "company_pages_company_idx" ON "company_pages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "contacts_company_idx" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "crawl_jobs_status_idx" ON "crawl_jobs" USING btree ("status","priority" DESC NULLS LAST,"created_at");--> statement-breakpoint
CREATE INDEX "crawl_jobs_company_idx" ON "crawl_jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "email_messages_company_idx" ON "email_messages" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "search_job_items_job_idx" ON "search_job_items" USING btree ("search_job_id");--> statement-breakpoint
CREATE INDEX "search_jobs_status_idx" ON "search_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "suppression_list_company_idx" ON "suppression_list" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "suppression_list_email_idx" ON "suppression_list" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "suppression_list_domain_idx" ON "suppression_list" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "system_logs_created_idx" ON "system_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "system_logs_category_idx" ON "system_logs" USING btree ("category","created_at" DESC NULLS LAST);