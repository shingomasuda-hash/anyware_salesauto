import type { AiProvider, AnalysisRequest, AnalysisResult } from "./provider";
import { getSalesOffering } from "@/lib/config/offering";
import type { CompanyAnalysisOutput } from "./schemas";

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Claude を呼ばずにクロール結果からヒューリスティックに分析結果を生成するモック。
 * UI 確認 / テスト / API キー未設定時の動作確認用。
 */
export class MockAiProvider implements AiProvider {
  readonly name = "mock" as const;

  async analyzeCompany(request: AnalysisRequest): Promise<AnalysisResult> {
    const started = Date.now();
    const hints = request.mockHints ?? {
      companyName: "不明",
      websiteUrl: null,
      pageTypes: [],
      hasSns: false,
      hasEmail: false,
      hasContactForm: false,
      salesRestrictionText: null,
      salesRestrictionUrl: null,
      urls: [],
    };
    const ctx = request.contextText;
    const h = hash(hints.companyName);
    const types = new Set(hints.pageTypes);
    const hasRecruit = types.has("recruit") || types.has("job_listing") || types.has("recruit_mid_career") || types.has("recruit_new_graduate");
    const hasInterview = /社員インタビュー|先輩社員|社員の声/.test(ctx);
    const newGrad = /新卒/.test(ctx);
    const midCareer = /中途|キャリア採用|正社員/.test(ctx);
    const modern = /DX|自社開発|システム|見える化|クラウド/.test(ctx);
    const yearMatch = ctx.match(/©\s*(20\d\d)|(20\d\d)\.\d\d\.\d\d/);
    const latestYear = yearMatch ? Number(yearMatch[1] ?? yearMatch[2]) : null;
    const snsCount = (ctx.match(/Instagram=|Facebook=|X=|YouTube=|LinkedIn=|TikTok=/g) ?? []).length;

    const recruitIssue = hasRecruit ? 55 + (hasInterview ? -15 : 10) + (midCareer ? 10 : 0) + (h % 15) : 35 + (h % 20);
    const recruitQuality = hasRecruit ? (hasInterview ? 60 : 35) + (h % 15) : null;
    const web = (modern ? 60 : 40) + (latestYear && latestYear >= 2024 ? 10 : latestYear && latestYear <= 2021 ? -15 : 0) + (h % 10);
    const sns = Math.min(100, snsCount * 22 + (h % 10));
    const dm = hints.hasContactForm ? 35 + (h % 15) : 15 + (h % 10);
    const dx = (modern ? 35 : 65) + (h % 15);
    const growth = (hasRecruit ? 55 : 35) + (newGrad ? 10 : 0) + (h % 15);

    const facts: string[] = [];
    if (hints.websiteUrl) facts.push(`公式サイトを確認: ${hints.websiteUrl}`);
    if (hasRecruit) facts.push("採用情報ページが存在する");
    if (midCareer) facts.push("中途採用（正社員）の募集記載あり");
    if (newGrad) facts.push("新卒採用の記載あり");
    if (hasInterview) facts.push("社員インタビューが掲載されている");
    else if (hasRecruit) facts.push("社員インタビュー・社員紹介コンテンツが見当たらない");
    facts.push(snsCount > 0 ? `SNS公式リンクを${snsCount}件検出` : "SNS公式アカウントへのリンクが見当たらない");
    if (hints.hasEmail) facts.push("問い合わせ用メールアドレスが公開されている");
    if (hints.hasContactForm) facts.push("問い合わせフォームが存在する");
    if (latestYear) facts.push(`サイト上の最新の年表記は ${latestYear} 年`);
    if (hints.salesRestrictionText) facts.push(`営業拒否表記あり: 「${hints.salesRestrictionText.slice(0, 60)}」`);

    const inferences: string[] = [];
    if (hasRecruit && !hasInterview) inferences.push("採用ページが簡易的で、求職者向けの魅力訴求が弱い可能性");
    if (snsCount === 0) inferences.push("SNSを活用した情報発信は行っていない可能性が高い");
    if (!modern) inferences.push("業務のデジタル化余地が大きい可能性");
    if (latestYear && latestYear <= 2021) inferences.push("サイト更新が停滞している可能性");

    const issues = [
      ...(hasRecruit && !hasInterview ? ["採用ページに社員紹介・インタビューがない"] : []),
      ...(snsCount === 0 ? ["SNS公式アカウントが未整備"] : []),
      ...(!hints.hasContactForm ? ["問い合わせフォームが見当たらない"] : []),
      ...(latestYear && latestYear <= 2021 ? ["Webサイトの更新が古い"] : []),
    ];
    const strengths = [
      ...(hasRecruit ? ["採用に積極的（複数職種を募集）"] : []),
      ...(modern ? ["自社でシステム・DXに取り組んでいる"] : []),
      ...(snsCount >= 2 ? ["複数のSNSで情報発信している"] : []),
    ];
    const topics = [
      ...(hasRecruit && !hasInterview ? ["採用ページ・採用LPの改善"] : []),
      ...(snsCount === 0 ? ["SNS運用の立ち上げ"] : []),
      ...(!modern ? ["業務効率化・DX支援"] : []),
      ...(web < 50 ? ["Webサイトのリニューアル"] : []),
    ];

    const evidence: CompanyAnalysisOutput["evidence"] = hints.urls.slice(0, 6).map((url, i) => ({
      category: /recruit|saiyo|career/i.test(url) ? "recruiting" : /contact/i.test(url) ? "contact" : /company|about/i.test(url) ? "company" : i === 0 ? "web" : "other",
      source_url: url,
      evidence_text: /recruit/i.test(url) ? (hasInterview ? "採用ページに社員インタビューあり" : "採用ページに募集職種の記載あり（社員紹介なし）") : /contact/i.test(url) ? (hints.salesRestrictionText ? `営業拒否表記: ${hints.salesRestrictionText.slice(0, 80)}` : "問い合わせフォーム・電話番号を確認") : i === 0 ? `トップページ（${latestYear ? `最新年表記 ${latestYear}` : "年表記なし"}）` : "ページ内容を確認",
    }));

    const offering = getSalesOffering();
    const output: CompanyAnalysisOutput = {
      company_summary: `${hints.companyName}。公式サイトの記載に基づくと、${ctx.match(/製造|加工/) ? "製造・加工" : "事業"}を主軸とする企業。`,
      business_summary: summarizeBusiness(ctx),
      recruiting_status: hasRecruit ? "active" : "unknown",
      recruiting_summary: hasRecruit ? `${[newGrad && "新卒", midCareer && "中途"].filter(Boolean).join("・") || "職種不明"}の採用を実施中${hasInterview ? "。社員インタビューあり" : "。社員紹介なし"}` : null,
      target_candidates: [...(newGrad ? ["新卒"] : []), ...(midCareer ? ["中途（正社員）"] : [])],
      new_graduate_hiring: newGrad ? "yes" : hasRecruit ? "no" : "unknown",
      mid_career_hiring: midCareer ? "yes" : hasRecruit ? "no" : "unknown",
      employee_count_observed: (() => {
        const m = ctx.match(/従業員数[^\d]{0,10}(\d{1,5})名/);
        return m ? Number(m[1]) : null;
      })(),
      scores: {
        recruitment_page_quality_score: recruitQuality === null ? null : clamp(recruitQuality),
        recruitment_issue_score: clamp(recruitIssue),
        web_quality_score: clamp(web),
        sns_activity_score: clamp(sns),
        digital_marketing_score: clamp(dm),
        dx_opportunity_score: clamp(dx),
        growth_potential_score: clamp(growth),
      },
      observed_facts: facts,
      inferences,
      detected_issues: issues,
      detected_strengths: strengths,
      recommended_topics: topics,
      sales_restriction: {
        detected: Boolean(hints.salesRestrictionText),
        restriction_text: hints.salesRestrictionText,
        source_url: hints.salesRestrictionUrl,
      },
      sales_outreach: offering.configured && !hints.salesRestrictionText
        ? {
            subject: `${hints.companyName}様 ${offering.name ?? "サービス"}のご提案`,
            body: `${hints.companyName} ご担当者様\n\n${facts[0] ?? "公式サイトを拝見しました"}という点を拝見し、ご連絡しました。\n${offering.summary ?? ""}\n\n${offering.cta ?? "一度お話をうかがえないでしょうか"}。\n\n${offering.senderCompany ?? ""}\n\n（モック生成: Claude API を使用していません）`,
            personalization: facts.slice(0, 2),
            hypothesis_note: "課題の想定はサイト記載からの推測です",
          }
        : null,
      evidence,
      analysis_reason: `【確認できた事実】\n${facts.map((f) => `・${f}`).join("\n")}\n\n【推測】\n${inferences.map((f) => `・${f}`).join("\n") || "・特になし"}\n\n（モック分析: Claude API を使用していません）`,
      confidence_score: 40 + (hints.pageTypes.length > 3 ? 20 : 0),
    };

    await new Promise((r) => setTimeout(r, 30));
    return {
      output,
      usage: { inputTokens: Math.round(ctx.length / 2.5), outputTokens: 900, cacheReadTokens: 0, cacheCreationTokens: 0 },
      model: "mock-analyzer",
      provider: "mock",
      durationMs: Date.now() - started,
      retries: 0,
    };
  }
}

/** [business] ページ本文から見出し・URL 行を除いた要約を作る */
function summarizeBusiness(ctx: string): string {
  const block = ctx.match(/## \[business\][^\n]*\nURL: [^\n]*\n([\s\S]{0,600})/)?.[1] ?? ctx.match(/事業内容\n([\s\S]{0,400})/)?.[1];
  if (!block) return "事業内容の詳細な記載は確認できず";
  const lines = block.split("\n").map((l) => l.trim()).filter((l) => l && !/^##|^URL:|^事業内容$|ページです。$/.test(l));
  return lines.join(" / ").slice(0, 200) || "事業内容の詳細な記載は確認できず";
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}
