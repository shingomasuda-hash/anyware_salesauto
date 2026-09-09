/**
 * 実企業テストの検証レポート。
 * 取得・保存された企業データを1社ずつ点検し、精度指標とハルシネーション検査結果を出力する。
 * 検索ジョブIDを指定するとその回の企業のみ、省略すると全企業を対象にする。
 */
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../../src/db";
import { companies, companyAnalysis, companyAnalysisEvidence, companyPages, searchJobItems, suppressionList } from "../../src/db/schema";
import type { CompanyRow } from "../../src/db/types";
import { employeeRangeLabel, industryLabel } from "../../src/lib/companies/constants";

const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}% (${n}/${d})`);
const s = (v: unknown, max = 60) => (v === null || v === undefined || v === "" ? "—" : String(v).replace(/\s+/g, " ").slice(0, max));

export async function reportVerification(db: Db, searchJobId?: string): Promise<void> {
  const targetIds = searchJobId
    ? (await db.select({ id: searchJobItems.company_id }).from(searchJobItems).where(and(eq(searchJobItems.search_job_id, searchJobId), isNotNull(searchJobItems.company_id))))
        .map((r) => r.id)
        .filter((id): id is string => id !== null)
    : (await db.select({ id: companies.id }).from(companies)).map((r) => r.id);

  const ids = Array.from(new Set(targetIds));
  if (ids.length === 0) {
    console.log("対象企業がありません。");
    return;
  }

  const rows = await db.select().from(companies).where(inArray(companies.id, ids)).orderBy(desc(companies.created_at));
  const pages = await db.select().from(companyPages).where(inArray(companyPages.company_id, ids));
  const analyses = await db.select().from(companyAnalysis).where(inArray(companyAnalysis.company_id, ids)).orderBy(desc(companyAnalysis.analyzed_at));
  const evidence = await db.select().from(companyAnalysisEvidence).where(inArray(companyAnalysisEvidence.company_id, ids));
  const suppressed = await db.select().from(suppressionList).where(inArray(suppressionList.company_id, ids));

  const pagesOf = (id: string) => pages.filter((p) => p.company_id === id);
  const analysisOf = (c: CompanyRow) => analyses.find((a) => a.id === c.latest_analysis_id) ?? null;
  const evidenceOf = (analysisId: string | null) => (analysisId ? evidence.filter((e) => e.analysis_id === analysisId) : []);

  // ---------------- 企業ごとの詳細 ----------------
  console.log("=".repeat(78));
  console.log(`企業取得結果（${rows.length}社）`);
  console.log("=".repeat(78));
  for (const [i, c] of rows.entries()) {
    const a = analysisOf(c);
    const ps = pagesOf(c.id);
    const ev = evidenceOf(c.latest_analysis_id);
    const sns = [
      c.instagram_url && "Instagram",
      c.facebook_url && "Facebook",
      c.x_url && "X",
      c.youtube_url && "YouTube",
      c.linkedin_url && "LinkedIn",
      c.tiktok_url && "TikTok",
    ].filter(Boolean);

    console.log(`\n[${i + 1}] ${c.company_name}`);
    console.log(`  法人番号      : ${s(c.corporate_number)}`);
    console.log(`  所在地        : ${s(c.address, 80)}`);
    console.log(`  業種/規模     : ${s(industryLabel(c.industry) ?? c.industry)} / ${c.employee_count !== null ? `${c.employee_count}名` : employeeRangeLabel(c.employee_range)}`);
    console.log(`  公式HP        : ${s(c.website_url, 70)}`);
    console.log(`  HP判定        : ${c.verification_status} (confidence ${c.official_site_confidence ?? "—"})`);
    console.log(`  採用ページ    : ${s(c.recruit_page_url, 70)}`);
    console.log(`  新卒/中途     : ${a ? `${a.new_graduate_hiring} / ${a.mid_career_hiring}（採用活動: ${a.recruiting_status}）` : "—"}`);
    console.log(`  問い合わせ    : page=${s(c.contact_page_url, 50)} form=${s(c.contact_form_url, 50)}`);
    console.log(`  メール        : ${s(c.email)}`);
    console.log(`  電話          : ${s(c.phone)}`);
    console.log(`  SNS           : ${sns.length ? sns.join(", ") : "—"}`);
    console.log(`  営業拒否      : ${c.sales_contact_allowed}${c.sales_restriction_text ? ` 「${s(c.sales_restriction_text, 50)}」` : ""}`);
    console.log(`  クロール      : ${ps.length}ページ [${ps.map((p) => p.page_type).join(", ") || "—"}]`);
    if (a) {
      console.log(`  企業概要(AI)  : ${s(a.company_summary, 100)}`);
      console.log(`  スコア        : 採用課題 ${a.recruitment_issue_score ?? "—"} / Web ${a.web_quality_score ?? "—"} / SNS ${a.sns_activity_score ?? "—"} / デジマ ${a.digital_marketing_score ?? "—"} / DX ${a.dx_opportunity_score ?? "—"} / 成長 ${a.growth_potential_score ?? "—"}`);
      console.log(`  営業スコア    : ${a.sales_priority_score ?? "—"} → ランク ${a.sales_priority_rank ?? "—"}（信頼度 ${a.confidence_score ?? "—"}）`);
      console.log(`  事実/推測     : 事実 ${(a.observed_facts as unknown[])?.length ?? 0}件 / 推測 ${(a.inferences as unknown[])?.length ?? 0}件`);
      console.log(`  Evidence      : ${ev.length}件 ${ev.slice(0, 2).map((e) => `[${e.category}] ${s(e.source_url, 45)}`).join(" ")}`);
    } else {
      console.log(`  AI分析        : 未実施（analysis_status=${c.analysis_status}）`);
    }
  }

  // ---------------- 精度指標 ----------------
  const total = rows.length;
  const withCandidate = rows.filter((c) => c.verification_status !== "no_website").length;
  const verified = rows.filter((c) => c.verification_status === "verified" || c.verification_status === "manual").length;
  const needsReview = rows.filter((c) => c.verification_status === "needs_review").length;
  const noWebsite = rows.filter((c) => c.verification_status === "no_website").length;
  const crawled = rows.filter((c) => c.crawl_status === "crawled");
  const analyzed = rows.filter((c) => c.latest_analysis_id !== null);
  const analysisFailed = rows.filter((c) => c.analysis_status === "failed");
  const recruit = crawled.filter((c) => c.recruit_page_url !== null).length;
  const contact = crawled.filter((c) => c.contact_page_url || c.contact_form_url || c.email || c.phone).length;
  const email = crawled.filter((c) => c.email !== null).length;
  const sns = crawled.filter((c) => c.instagram_url || c.facebook_url || c.x_url || c.youtube_url || c.linkedin_url || c.tiktok_url).length;
  const restricted = rows.filter((c) => c.sales_contact_allowed === "false");
  const allowedTrue = rows.filter((c) => c.sales_contact_allowed === "true").length;
  const unknown = rows.filter((c) => c.sales_contact_allowed === "unknown").length;

  console.log(`\n${"=".repeat(78)}`);
  console.log("精度指標");
  console.log("=".repeat(78));
  console.log(`公式サイト判定率      : ${pct(verified, total)}（要確認 ${needsReview} / HPなし ${noWebsite} / 候補あり ${withCandidate}）`);
  console.log(`クロール成功率        : ${pct(crawled.length, verified)}`);
  console.log(`採用ページ検出率      : ${pct(recruit, crawled.length)}`);
  console.log(`問い合わせ情報検出率  : ${pct(contact, crawled.length)}（うちメール ${pct(email, crawled.length)}）`);
  console.log(`SNS検出率             : ${pct(sns, crawled.length)}`);
  console.log(`AI分析成功率          : ${pct(analyzed.length, crawled.length)}（失敗 ${analysisFailed.length}社）`);
  console.log(`営業拒否検出          : 不可 ${restricted.length} / 可 ${allowedTrue} / 不明 ${unknown}`);

  const ranks = { A: 0, B: 0, C: 0, D: 0 } as Record<string, number>;
  for (const c of analyzed) {
    const r = analysisOf(c)?.sales_priority_rank;
    if (r) ranks[r] += 1;
  }
  console.log(`営業ランク分布        : A ${ranks.A} / B ${ranks.B} / C ${ranks.C} / D ${ranks.D}`);

  // ---------------- ハルシネーション・整合性検査 ----------------
  console.log(`\n${"=".repeat(78)}`);
  console.log("ハルシネーション・整合性検査");
  console.log("=".repeat(78));
  const problems: string[] = [];

  // 1. Evidence の URL がクロール済みページに存在するか（捏造URLの検出）
  const pageUrls = new Set(pages.map((p) => p.url));
  const fabricated = evidence.filter((e) => e.source_url && !pageUrls.has(e.source_url) && !rows.some((c) => c.website_url === e.source_url));
  console.log(`${fabricated.length === 0 ? "✅" : "❌"} Evidence URL: ${evidence.length}件中 ${fabricated.length}件がクロール済みページに存在しない`);
  if (fabricated.length > 0) problems.push(`Evidence に実在しない URL が ${fabricated.length}件`);

  // 2. 保存されたメールがクロール本文に実在するか（推測生成の検出）
  let emailNotFound = 0;
  for (const c of rows.filter((x) => x.email)) {
    const text = pagesOf(c.id).map((p) => p.raw_text ?? "").join("\n").toLowerCase();
    if (!text.includes((c.email ?? "").toLowerCase())) emailNotFound++;
  }
  console.log(`${emailNotFound === 0 ? "✅" : "❌"} メールアドレス: 保存 ${email}件中 ${emailNotFound}件がクロール本文に見つからない（推測生成の疑い）`);
  if (emailNotFound > 0) problems.push(`本文に存在しないメールアドレスが ${emailNotFound}件`);

  // 3. 営業拒否企業が suppression_list に登録され、営業可能として扱われていないか
  const missingSuppression = restricted.filter((c) => !suppressed.some((sp) => sp.company_id === c.id));
  console.log(`${missingSuppression.length === 0 ? "✅" : "❌"} 営業拒否: ${restricted.length}社中 ${missingSuppression.length}社が suppression_list 未登録`);
  if (missingSuppression.length > 0) problems.push(`suppression_list 未登録の営業拒否企業が ${missingSuppression.length}社`);

  const restrictedInList = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(companies)
    .where(and(inArray(companies.id, ids), eq(companies.sales_contact_allowed, "false")));
  console.log(`   （営業拒否除外フィルタ適用時に除外される企業数: ${restrictedInList[0]?.count ?? 0}社）`);

  // 4. 問い合わせページ未確認の企業を「営業可」と断定していないか
  const trueWithoutContactPage = rows.filter(
    (c) => c.sales_contact_allowed === "true" && !pagesOf(c.id).some((p) => ["contact", "privacy"].includes(p.page_type) && (p.raw_text ?? "").trim().length > 0),
  );
  console.log(`${trueWithoutContactPage.length === 0 ? "✅" : "❌"} 営業可の根拠: 問い合わせ系ページ未取得なのに「可」と判定された企業 ${trueWithoutContactPage.length}社`);
  if (trueWithoutContactPage.length > 0) problems.push(`根拠なく営業可と判定された企業が ${trueWithoutContactPage.length}社`);

  // 5. 事実と推測が分離されているか
  const noFacts = analyzed.filter((c) => ((analysisOf(c)?.observed_facts as unknown[]) ?? []).length === 0);
  console.log(`${noFacts.length === 0 ? "✅" : "⚠️"} 事実/推測の分離: 分析 ${analyzed.length}社中 ${noFacts.length}社で observed_facts が空`);

  // 6. 重複（法人番号・ドメイン）
  const dupCorp = new Map<string, number>();
  const dupDomain = new Map<string, number>();
  for (const c of rows) {
    if (c.corporate_number) dupCorp.set(c.corporate_number, (dupCorp.get(c.corporate_number) ?? 0) + 1);
    if (c.website_domain) dupDomain.set(c.website_domain, (dupDomain.get(c.website_domain) ?? 0) + 1);
  }
  const dupCorpCount = [...dupCorp.values()].filter((n) => n > 1).length;
  const dupDomainCount = [...dupDomain.values()].filter((n) => n > 1).length;
  console.log(`${dupCorpCount + dupDomainCount === 0 ? "✅" : "❌"} 重複排除: 法人番号重複 ${dupCorpCount}件 / ドメイン重複 ${dupDomainCount}件`);
  if (dupCorpCount + dupDomainCount > 0) problems.push(`重複企業が存在（法人番号 ${dupCorpCount} / ドメイン ${dupDomainCount}）`);

  // 7. スコアの整合性（0-100、ランクとスコアの対応）
  const badScore = analyzed.filter((c) => {
    const a = analysisOf(c);
    if (!a) return false;
    const vals = [a.recruitment_issue_score, a.web_quality_score, a.sns_activity_score, a.digital_marketing_score, a.dx_opportunity_score, a.growth_potential_score, a.sales_priority_score, a.confidence_score];
    return vals.some((v) => v !== null && (v < 0 || v > 100));
  });
  console.log(`${badScore.length === 0 ? "✅" : "❌"} スコア範囲: 0〜100 を外れた企業 ${badScore.length}社`);
  if (badScore.length > 0) problems.push(`スコアが範囲外の企業が ${badScore.length}社`);

  console.log(`\n${"=".repeat(78)}`);
  if (problems.length === 0) {
    console.log("✅ 検査項目にすべて合格しました。");
  } else {
    console.log(`❌ ${problems.length}件の問題を検出:`);
    problems.forEach((p) => console.log(`   - ${p}`));
  }
  console.log("=".repeat(78));
}
