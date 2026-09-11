import { getAiConfig } from "@/lib/config/ai";
import type { Db } from "@/db";
import type { CompanyAnalysisRow, CompanyInsert, CompanyPageRow, CompanyRow, Json } from "@/db/types";
import { getCompanyById, updateCompany } from "@/db/repositories/companies";
import { listCompanyPages } from "@/db/repositories/pages";
import { insertAnalysis, insertEvidence } from "@/db/repositories/analysis";
import { insertAiUsageLog } from "@/db/repositories/logs";
import { ensureSuppression } from "@/db/repositories/suppression";
import { Logger, serializeError } from "@/lib/logging/logger";
import { computeSalesPriorityScore, rankFromScore } from "@/lib/scoring/priority";
import { employeeRangeFromCount } from "@/lib/companies/constants";
import { getAiProvider } from "./index";
import { buildAnalysisContext } from "./context";
import { getOutreachConfig, outreachLabel, outreachMissingHint } from "@/lib/config/outreach";
import { reviewOutreach } from "./outreach";
import type { CompanyAnalysisOutput } from "./schemas";

export interface AnalyzeCompanyResult {
  analysis: CompanyAnalysisRow;
  salesContactAllowed: "true" | "false" | "unknown";
}

/**
 * 企業のクロール済みページを元に Claude で分析し、結果を保存する。
 * 1) コンテキスト構築（トークン節約） 2) AI 呼び出し 3) スコアリング 4) 保存 5) 使用量ログ
 */
export async function analyzeCompany(db: Db, companyId: string, logger: Logger): Promise<AnalyzeCompanyResult> {
  const cfg = getAiConfig();
  const company = await getCompanyById(db, companyId);
  if (!company) throw new Error(`企業が見つかりません: ${companyId}`);

  const pageRows: CompanyPageRow[] = await listCompanyPages(db, companyId);
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
    await insertAiUsageLog(db, {
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
  const restriction = resolveSalesRestriction(company, out, pageRows);

  // 文面は「営業拒否が確認された企業には作らない」「推測した連絡先を書かせない」
  // 「その企業固有の事実に触れている」を機械的に担保する
  const outreachConfig = getOutreachConfig();
  const outreach = reviewOutreach(out.sales_outreach, {
    salesContactAllowed: restriction.allowed,
    knownEmails: [company.email],
    knownPhones: [company.phone],
    missingReason: outreachMissingHint(outreachConfig.purpose),
  });
  if (!outreach.ok && out.sales_outreach) {
    await logger.warn(`${outreachLabel(outreachConfig.purpose)}を破棄`, { company: company.company_name, reason: outreach.reason });
  }

  const analysis = await insertAnalysis(db, {
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
      outreach_subject: outreach.ok ? outreach.draft.subject : null,
      outreach_body: outreach.ok ? outreach.draft.body : null,
      outreach_personalization: (outreach.ok ? outreach.draft.personalization : null) as Json,
      outreach_hypothesis_note: outreach.ok ? outreach.draft.hypothesisNote : null,
      model: result.model,
      provider: result.provider,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
    });

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

  // 公的データ（GビズINFO）に従業員数が無く、AI がサイト記載から読み取った場合のみ採用する。
  // 公的データ由来と区別できるよう、必ず出所を Evidence に残す。
  const observedEmployeeCount = company.employee_count === null ? (out.employee_count_observed ?? null) : null;
  if (observedEmployeeCount !== null) {
    const sourcePage = pageRows.find((p) => p.page_type === "company") ?? pageRows.find((p) => p.page_type === "top") ?? pageRows[0];
    evidenceRows.push({
      company_id: companyId,
      analysis_id: analysis.id,
      category: "company",
      source_url: sourcePage.url,
      source_title: sourcePage.title,
      evidence_text: `従業員数 ${observedEmployeeCount}名（公式サイト記載としてAIが読み取り。公的登録データではありません）`,
    });
  }
  try {
    await insertEvidence(db, evidenceRows);
  } catch (err) {
    await logger.warn("Evidence の保存に失敗", serializeError(err));
  }

  await insertAiUsageLog(db, {
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

  const companyUpdate: Partial<CompanyInsert> = {
    latest_analysis_id: analysis.id,
    analysis_status: "analyzed",
    last_analyzed_at: analysis.analyzed_at,
    sales_contact_allowed: restriction.allowed,
    sales_restriction_text: restriction.text,
    sales_restriction_source_url: restriction.sourceUrl,
  };
  if (observedEmployeeCount !== null) {
    companyUpdate.employee_count = observedEmployeeCount;
    companyUpdate.employee_range = employeeRangeFromCount(observedEmployeeCount);
  }
  await updateCompany(db, companyId, companyUpdate);

  if (restriction.allowed === "false") {
    await ensureSuppression(db, { companyId, reason: "sales_restriction_detected", note: restriction.text, sourceUrl: restriction.sourceUrl });
  }

  await logger.info("AI分析が完了", {
    rank,
    salesPriority,
    confidence: out.confidence_score,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    retries: result.retries,
    salesContactAllowed: restriction.allowed,
    outreach: outreach.ok ? `${outreachLabel(outreachConfig.purpose)}を作成` : outreach.reason,
  });

  return { analysis, salesContactAllowed: restriction.allowed };
}

/** 営業拒否表記が掲載されうるページ種別（主に問い合わせページ） */
const RESTRICTION_BEARING_PAGE_TYPES = ["contact", "privacy"];

/**
 * 営業可否の確定。
 * - 一度 false になった企業は再分析でも false のまま（誤って営業可能に戻さない）
 * - AI が検出した場合も false
 * - 表記が見つからなくても、拒否表記が載る問い合わせ系ページをクロールできていない場合は
 *   「確認できていない」ため unknown（true と断定しない）
 */
export function resolveSalesRestriction(
  company: CompanyRow,
  out: CompanyAnalysisOutput,
  pages: CompanyPageRow[],
): { allowed: "true" | "false" | "unknown"; text: string | null; sourceUrl: string | null } {
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
  const checked = pages.some((p) => RESTRICTION_BEARING_PAGE_TYPES.includes(p.page_type) && (p.raw_text ?? "").trim().length > 0);
  if (!checked) return { allowed: "unknown", text: null, sourceUrl: null };
  return { allowed: "true", text: null, sourceUrl: null };
}

