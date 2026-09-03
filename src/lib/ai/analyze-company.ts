import { getAiConfig } from "@/lib/config/ai";
import type { AdminClient } from "@/lib/supabase/admin";
import type { CompanyAnalysisRow, CompanyPageRow, CompanyRow, Json } from "@/lib/db/types";
import { Logger, serializeError } from "@/lib/logging/logger";
import { computeSalesPriorityScore, rankFromScore } from "@/lib/scoring/priority";
import { getAiProvider } from "./index";
import { buildAnalysisContext } from "./context";
import type { CompanyAnalysisOutput } from "./schemas";

export interface AnalyzeCompanyResult {
  analysis: CompanyAnalysisRow;
  salesContactAllowed: "true" | "false" | "unknown";
}

/**
 * 企業のクロール済みページを元に Claude で分析し、結果を保存する。
 * 1) コンテキスト構築（トークン節約） 2) AI 呼び出し 3) スコアリング 4) 保存 5) 使用量ログ
 */
export async function analyzeCompany(db: AdminClient, companyId: string, logger: Logger): Promise<AnalyzeCompanyResult> {
  const cfg = getAiConfig();
  const { data: company, error: cErr } = await db.from("companies").select("*").eq("id", companyId).single();
  if (cErr || !company) throw new Error(`企業が見つかりません: ${companyId}`);

  const { data: pages, error: pErr } = await db.from("company_pages").select("*").eq("company_id", companyId).order("crawled_at", { ascending: false });
  if (pErr) throw new Error(`ページ取得失敗: ${pErr.message}`);
  const pageRows: CompanyPageRow[] = pages ?? [];
  if (pageRows.filter((p) => (p.raw_text ?? "").length > 0).length === 0) {
    throw new Error("分析対象のクロール済みページがありません（先にクロールしてください）");
  }

  const context = buildAnalysisContext(company, pageRows, cfg.maxContextChars);
  const provider = getAiProvider();
  await logger.info("AI分析を開始", { provider: provider.name, pages: context.pageCount, chars: context.charCount });

  let result;
  try {
    result = await provider.analyzeCompany({
      contextText: context.text,
      mockHints: {
        companyName: company.company_name,
        websiteUrl: company.website_url,
        pageTypes: pageRows.map((p) => p.page_type),
        hasSns: Boolean(company.instagram_url || company.facebook_url || company.x_url || company.youtube_url || company.linkedin_url || company.tiktok_url),
        hasEmail: Boolean(company.email),
        hasContactForm: Boolean(company.contact_form_url),
        salesRestrictionText: company.sales_restriction_text,
        salesRestrictionUrl: company.sales_restriction_source_url,
        urls: context.urls,
      },
    });
  } catch (err) {
    await db.from("ai_usage_logs").insert({
      company_id: companyId,
      purpose: "company_analysis",
      provider: provider.name,
      model: cfg.model,
      success: false,
      error: err instanceof Error ? err.message.slice(0, 500) : String(err),
    });
    await logger.error("AI分析に失敗", serializeError(err));
    throw err;
  }

  const out = result.output;
  const salesPriority = computeSalesPriorityScore(out.scores);
  const rank = rankFromScore(salesPriority);

  // 営業拒否: ルール検出 or AI 検出のいずれかで false
  const restriction = resolveSalesRestriction(company, out);

  const { data: analysis, error: aErr } = await db
    .from("company_analysis")
    .insert({
      company_id: companyId,
      company_summary: out.company_summary,
      business_summary: out.business_summary,
      recruiting_status: out.recruiting_status,
      recruiting_summary: out.recruiting_summary,
      target_candidates: out.target_candidates,
      new_graduate_hiring: out.new_graduate_hiring,
      mid_career_hiring: out.mid_career_hiring,
      recruitment_page_quality_score: out.scores.recruitment_page_quality_score,
      recruitment_issue_score: out.scores.recruitment_issue_score,
      web_quality_score: out.scores.web_quality_score,
      sns_activity_score: out.scores.sns_activity_score,
      digital_marketing_score: out.scores.digital_marketing_score,
      dx_opportunity_score: out.scores.dx_opportunity_score,
      growth_potential_score: out.scores.growth_potential_score,
      sales_priority_score: salesPriority,
      sales_priority_rank: rank,
      detected_issues: out.detected_issues as Json,
      detected_strengths: out.detected_strengths as Json,
      recommended_topics: out.recommended_topics as Json,
      observed_facts: out.observed_facts as Json,
      inferences: out.inferences as Json,
      analysis_reason: out.analysis_reason,
      confidence_score: out.confidence_score,
      model: result.model,
      provider: result.provider,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
    })
    .select("*")
    .single();
  if (aErr || !analysis) throw new Error(`分析結果の保存に失敗: ${aErr?.message}`);

  // Evidence: 与えた URL のみ許可（AI が捏造した URL は保存しない）
  const allowedUrls = new Set(context.urls);
  const evidenceRows = out.evidence
    .filter((e) => allowedUrls.has(e.source_url) || pageRows.some((p) => p.url === e.source_url))
    .map((e) => ({
      company_id: companyId,
      analysis_id: analysis.id,
      category: e.category,
      source_url: e.source_url,
      source_title: pageRows.find((p) => p.url === e.source_url)?.title ?? null,
      evidence_text: e.evidence_text,
    }));
  if (restriction.text && restriction.sourceUrl) {
    evidenceRows.push({
      company_id: companyId,
      analysis_id: analysis.id,
      category: "sales_restriction",
      source_url: restriction.sourceUrl,
      source_title: pageRows.find((p) => p.url === restriction.sourceUrl)?.title ?? null,
      evidence_text: restriction.text,
    });
  }
  if (evidenceRows.length > 0) {
    const { error: eErr } = await db.from("company_analysis_evidence").insert(evidenceRows);
    if (eErr) await logger.warn("Evidence の保存に失敗", { error: eErr.message });
  }

  await db.from("ai_usage_logs").insert({
    company_id: companyId,
    analysis_id: analysis.id,
    purpose: "company_analysis",
    provider: result.provider,
    model: result.model,
    input_tokens: result.usage.inputTokens,
    output_tokens: result.usage.outputTokens,
    cache_read_tokens: result.usage.cacheReadTokens,
    cache_creation_tokens: result.usage.cacheCreationTokens,
    duration_ms: result.durationMs,
    success: true,
  });

  const companyUpdate: Partial<CompanyRow> = {
    latest_analysis_id: analysis.id,
    analysis_status: "analyzed",
    last_analyzed_at: analysis.analyzed_at,
    sales_contact_allowed: restriction.allowed,
    sales_restriction_text: restriction.text,
    sales_restriction_source_url: restriction.sourceUrl,
  };
  if (company.employee_count === null && out.employee_count_observed) {
    companyUpdate.employee_count = out.employee_count_observed;
  }
  const { error: uErr } = await db.from("companies").update(companyUpdate).eq("id", companyId);
  if (uErr) throw new Error(`企業の更新に失敗: ${uErr.message}`);

  if (restriction.allowed === "false") {
    await upsertSuppression(db, companyId, restriction.text, restriction.sourceUrl);
  }

  await logger.info("AI分析が完了", {
    rank,
    salesPriority,
    confidence: out.confidence_score,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    retries: result.retries,
    salesContactAllowed: restriction.allowed,
  });

  return { analysis, salesContactAllowed: restriction.allowed };
}

function resolveSalesRestriction(company: CompanyRow, out: CompanyAnalysisOutput): { allowed: "true" | "false" | "unknown"; text: string | null; sourceUrl: string | null } {
  if (company.sales_contact_allowed === "false") {
    return { allowed: "false", text: company.sales_restriction_text, sourceUrl: company.sales_restriction_source_url };
  }
  if (out.sales_restriction.detected && out.sales_restriction.restriction_text) {
    return { allowed: "false", text: out.sales_restriction.restriction_text, sourceUrl: out.sales_restriction.source_url ?? company.sales_restriction_source_url };
  }
  // ルール検出で低確信度のヒットがあったが AI が否定した場合は unknown のまま
  if (company.sales_restriction_text) {
    return { allowed: "unknown", text: company.sales_restriction_text, sourceUrl: company.sales_restriction_source_url };
  }
  return { allowed: "true", text: null, sourceUrl: null };
}

async function upsertSuppression(db: AdminClient, companyId: string, text: string | null, sourceUrl: string | null) {
  const { data: existing } = await db.from("suppression_list").select("id").eq("company_id", companyId).eq("reason", "sales_restriction_detected").limit(1);
  if (existing && existing.length > 0) return;
  await db.from("suppression_list").insert({
    company_id: companyId,
    reason: "sales_restriction_detected",
    note: text,
    source_url: sourceUrl,
  });
}
