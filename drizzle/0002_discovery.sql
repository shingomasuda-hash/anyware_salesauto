CREATE TABLE "company_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"source_url" text,
	"source_type" text DEFAULT 'discovery' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"observed_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"address" text,
	"address_normalized" text,
	"prefecture" text,
	"city" text,
	"phone" text,
	"website" text,
	"domain" text,
	"corporate_number" text,
	"industry" text,
	"primary_source" text NOT NULL,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_confidence" integer DEFAULT 0 NOT NULL,
	"verification_score" integer,
	"verification_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"official_site_confidence" integer,
	"recruiting_signal" text DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'discovered' NOT NULL,
	"reject_reason" text,
	"company_id" uuid,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_candidates_status_check" CHECK ("discovery_candidates"."status" in ('discovered','verifying','verified','needs_review','duplicate','rejected','failed')),
	CONSTRAINT "discovery_candidates_recruiting_check" CHECK ("discovery_candidates"."recruiting_signal" in ('yes','no','unknown'))
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"criteria" jsonb NOT NULL,
	"mode" text DEFAULT 'hybrid' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"phase" text DEFAULT 'discovering' NOT NULL,
	"requested_count" integer DEFAULT 100 NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"verified_count" integer DEFAULT 0 NOT NULL,
	"needs_review_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"promoted_count" integer DEFAULT 0 NOT NULL,
	"provider_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budget" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"created_by" text,
	"locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_runs_status_check" CHECK ("discovery_runs"."status" in ('pending','running','completed','partially_completed','failed','cancelled')),
	CONSTRAINT "discovery_runs_mode_check" CHECK ("discovery_runs"."mode" in ('gbiz','places','search','hybrid'))
);
--> statement-breakpoint
ALTER TABLE "company_sources" ADD CONSTRAINT "company_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_run_id_discovery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."discovery_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_sources_company_idx" ON "company_sources" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_sources_company_provider_key" ON "company_sources" USING btree ("company_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "discovery_candidates_run_idx" ON "discovery_candidates" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "discovery_candidates_status_idx" ON "discovery_candidates" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "discovery_candidates_corp_idx" ON "discovery_candidates" USING btree ("corporate_number");--> statement-breakpoint
CREATE INDEX "discovery_candidates_domain_idx" ON "discovery_candidates" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "discovery_candidates_name_idx" ON "discovery_candidates" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "discovery_runs_status_idx" ON "discovery_runs" USING btree ("status","created_at");