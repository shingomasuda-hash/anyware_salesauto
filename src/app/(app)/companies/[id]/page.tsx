import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContactAllowedBadge, JobStatusBadge, RankBadge, VerificationBadge } from "@/components/companies/badges";
import { AnalyzeOnlyButton, ReanalyzeButton, SalesContactSelect } from "@/components/companies/company-actions";
import { OfficialSiteForm, type SiteCandidate } from "@/components/companies/official-site-form";
import { BulletList, DefinitionList, ExternalA, ScoreTile, Section } from "@/components/companies/detail-sections";
import { employeeRangeLabel, industryLabel, SALES_RANKS } from "@/lib/companies/constants";
import { getCompanyDetail } from "@/lib/companies/queries";
import { getRequestDb } from "@/lib/supabase/request-db";
import { formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

const PAGE_TYPE_LABEL: Record<string, string> = {
  top: "TOP",
  company: "会社概要",
  business: "事業内容",
  recruit: "採用情報",
  recruit_new_graduate: "新卒採用",
  recruit_mid_career: "中途採用",
  job_listing: "求人情報",
  news: "ニュース",
  employee: "社員紹介",
  message: "代表メッセージ",
  contact: "問い合わせ",
  privacy: "ポリシー等",
  other: "その他",
};

export default async function CompanyDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; duplicate?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const db = await getRequestDb();
  const detail = await getCompanyDetail(db, id);
  if (!detail) notFound();
  const { company: c, analysis: a, evidence, pages, crawlJobs, analysisJobs, analysisHistory } = detail;
  const candidates = ((c.website_candidates as unknown as SiteCandidate[]) ?? []).filter((x) => x && x.url);
  const processing = crawlJobs.some((j) => ["pending", "processing", "retrying"].includes(j.status)) || analysisJobs.some((j) => ["pending", "processing", "retrying"].includes(j.status));
  const snsItems = [
    { label: "Instagram", value: c.instagram_url },
    { label: "Facebook", value: c.facebook_url },
    { label: "X", value: c.x_url },
    { label: "YouTube", value: c.youtube_url },
    { label: "LinkedIn", value: c.linkedin_url },
    { label: "TikTok", value: c.tiktok_url },
  ];
  const rankDef = SALES_RANKS.find((r) => r.key === a?.sales_priority_rank);

  return (
    <div className="max-w-6xl">
      <div className="mb-2 text-xs text-muted-foreground">
        <Link href="/companies" className="hover:underline">
          企業一覧
        </Link>{" "}
        / {c.company_name}
      </div>
      <PageHeader
        title={c.company_name}
        description={[c.company_name_kana, c.address].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <SalesContactSelect companyId={c.id} value={c.sales_contact_allowed} />
            <AnalyzeOnlyButton companyId={c.id} disabled={processing || pages.length === 0} />
            <ReanalyzeButton companyId={c.id} disabled={processing} />
          </>
        }
      />

      {sp.created ? (
        <Alert variant="info" className="mb-4">
          <AlertDescription>企業を登録しました。公式サイトの確認・クロール・AI分析をバックグラウンドで実行しています。</AlertDescription>
        </Alert>
      ) : null}
      {sp.duplicate ? (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>同一企業が既に登録されていたため、既存の企業を表示しています。</AlertDescription>
        </Alert>
      ) : null}
      {processing ? (
        <Alert variant="info" className="mb-4">
          <AlertDescription>クロールまたはAI分析が処理中です。完了後にページを更新してください。</AlertDescription>
        </Alert>
      ) : null}
      {c.sales_contact_allowed === "false" ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            <span className="font-medium">営業拒否表記あり:</span> {c.sales_restriction_text ?? "（手動設定）"}
            {c.sales_restriction_source_url ? (
              <>
                {" "}
                <ExternalA href={c.sales_restriction_source_url}>出典</ExternalA>
              </>
            ) : null}
            <span className="block text-xs">この企業は将来の自動メール送信対象から除外されます（suppression_list 登録済み）。</span>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <VerificationBadge value={c.verification_status} confidence={c.official_site_confidence} />
        <ContactAllowedBadge value={c.sales_contact_allowed} />
        <Badge variant="outline">{c.source}</Badge>
        {a ? (
          <span className="ml-2 inline-flex items-center gap-2">
            <RankBadge rank={a.sales_priority_rank} />
            <span className="text-muted-foreground">
              営業スコア <span className="font-medium text-foreground tabular-nums">{a.sales_priority_score ?? "—"}</span>
              {rankDef ? ` · ${rankDef.description}` : ""}
            </span>
          </span>
        ) : (
          <Badge variant="muted">未分析</Badge>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="基本情報">
          <DefinitionList
            items={[
              { label: "法人番号", value: c.corporate_number },
              { label: "所在地", value: c.address },
              { label: "郵便番号", value: c.postal_code },
              { label: "業種", value: [industryLabel(c.industry) ?? c.industry, c.industry_detail].filter(Boolean).join(" / ") || null },
              { label: "従業員数", value: c.employee_count !== null ? `${formatNumber(c.employee_count)}名（${employeeRangeLabel(c.employee_range)}）` : "不明" },
              { label: "資本金", value: c.capital !== null ? `${formatNumber(c.capital)}円` : null },
              { label: "設立", value: c.established_date },
              { label: "代表者", value: c.representative_name },
              { label: "電話", value: c.phone },
              { label: "登録日", value: formatDate(c.created_at, true) },
            ]}
          />
          {c.description ? <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{c.description}</p> : null}
        </Section>

        <Section title="公式Webサイト・問い合わせ">
          <DefinitionList
            items={[
              { label: "公式サイト", value: <ExternalA href={c.website_url} /> },
              { label: "ドメイン", value: c.website_domain },
              { label: "判定信頼度", value: c.official_site_confidence !== null ? `${c.official_site_confidence} / 100` : null },
              { label: "メール", value: c.email ?? <span className="text-muted-foreground">未検出（推測生成はしません）</span> },
              { label: "問い合わせページ", value: <ExternalA href={c.contact_page_url} /> },
              { label: "問い合わせフォーム", value: <ExternalA href={c.contact_form_url} /> },
              { label: "採用ページ", value: <ExternalA href={c.recruit_page_url} /> },
              { label: "最終クロール", value: formatDate(c.last_crawled_at, true) },
            ]}
          />
          {c.verification_status === "needs_review" || c.verification_status === "unverified" || c.verification_status === "no_website" ? (
            <div className="mt-4 rounded-md bg-amber-50 p-3">
              <p className="mb-2 text-sm text-amber-800">
                {c.verification_status === "needs_review" ? "公式サイトを自動判定で断定できませんでした。候補を確認して設定してください。" : "公式サイトが未設定です。URL を設定するとクロール・分析を開始します。"}
              </p>
              <OfficialSiteForm companyId={c.id} candidates={candidates} />
            </div>
          ) : null}
        </Section>

        <Section title="SNS">
          <DefinitionList items={snsItems.map((s) => ({ label: s.label, value: <ExternalA href={s.value} /> }))} />
        </Section>

        <Section title="採用状況">
          {a ? (
            <>
              <DefinitionList
                items={[
                  { label: "採用活動", value: a.recruiting_status === "active" ? "実施中" : a.recruiting_status === "inactive" ? "確認できず" : "不明" },
                  { label: "新卒採用", value: a.new_graduate_hiring === "yes" ? "あり" : a.new_graduate_hiring === "no" ? "なし" : "不明" },
                  { label: "中途採用", value: a.mid_career_hiring === "yes" ? "あり" : a.mid_career_hiring === "no" ? "なし" : "不明" },
                  { label: "対象人材", value: a.target_candidates.length ? a.target_candidates.join("、") : null },
                ]}
              />
              {a.recruiting_summary ? <p className="mt-3 text-sm">{a.recruiting_summary}</p> : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">AI分析後に表示されます</p>
          )}
        </Section>
      </div>

      <div className="mt-4">
        <Section title="AI分析" actions={a ? <span className="text-xs text-muted-foreground">分析日 {formatDate(a.analyzed_at, true)} · {a.model} · 信頼度 {a.confidence_score ?? "—"}</span> : null}>
          {!a ? (
            <p className="text-sm text-muted-foreground">
              まだ分析されていません。{pages.length > 0 ? "「AI分析のみ」または「再解析」を実行してください。" : "公式サイトが確認できると自動でクロール・分析されます。"}
            </p>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                <ScoreTile label="営業優先度" value={a.sales_priority_score} hint={a.sales_priority_rank ? `ランク ${a.sales_priority_rank}` : undefined} />
                <ScoreTile label="採用課題" value={a.recruitment_issue_score} hint="高いほど課題大" />
                <ScoreTile label="採用ページ品質" value={a.recruitment_page_quality_score} />
                <ScoreTile label="Web活用" value={a.web_quality_score} />
                <ScoreTile label="SNS活用" value={a.sns_activity_score} />
                <ScoreTile label="デジマ活用" value={a.digital_marketing_score} />
                <ScoreTile label="DX余地" value={a.dx_opportunity_score} hint="高いほど余地大" />
                <ScoreTile label="成長可能性" value={a.growth_potential_score} />
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-sm font-medium">企業概要</h3>
                  <p className="text-sm">{a.company_summary ?? "—"}</p>
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-medium">事業内容</h3>
                  <p className="text-sm">{a.business_summary ?? "—"}</p>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-3">
                <div>
                  <h3 className="mb-1 text-sm font-medium">検出された課題</h3>
                  <BulletList items={a.detected_issues} />
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-medium">強み</h3>
                  <BulletList items={a.detected_strengths} />
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-medium">推奨トピック</h3>
                  <BulletList items={a.recommended_topics} />
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <h3 className="mb-1 text-sm font-medium">Web上で確認できた事実</h3>
                  <BulletList items={a.observed_facts} />
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-medium">AIによる推測</h3>
                  <BulletList items={a.inferences} />
                </div>
              </div>

              <div>
                <h3 className="mb-1 text-sm font-medium">分析理由</h3>
                <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm">{a.analysis_reason ?? "—"}</p>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">分析根拠（Evidence）</h3>
                {evidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground">根拠URLはありません</p>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>カテゴリ</TableHead>
                          <TableHead>根拠</TableHead>
                          <TableHead>URL</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {evidence.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell>
                              <Badge variant={e.category === "sales_restriction" ? "danger" : "outline"}>{e.category}</Badge>
                            </TableCell>
                            <TableCell className="whitespace-normal">{e.evidence_text}</TableCell>
                            <TableCell className="max-w-72 truncate">
                              <ExternalA href={e.source_url}>{e.source_title ?? e.source_url}</ExternalA>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {analysisHistory.length > 1 ? (
                <div className="text-xs text-muted-foreground">
                  分析履歴: {analysisHistory.map((h) => `${formatDate(h.analyzed_at)} ${h.sales_priority_rank ?? "-"}(${h.sales_priority_score ?? "-"})`).join(" → ")}
                </div>
              ) : null}
            </div>
          )}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Section title={`クロールページ（${pages.length}）`} actions={<span className="text-xs text-muted-foreground">最終クロール {formatDate(c.last_crawled_at, true)}</span>}>
          {pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">クロール済みページはありません</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>種別</TableHead>
                    <TableHead>タイトル / URL</TableHead>
                    <TableHead className="text-right">文字数</TableHead>
                    <TableHead className="text-right">HTTP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pages.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Badge variant="secondary">{PAGE_TYPE_LABEL[p.page_type] ?? p.page_type}</Badge>
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="truncate font-medium" title={p.title ?? undefined}>
                          {p.title ?? "(no title)"}
                        </div>
                        <ExternalA href={p.url}>
                          <span className="block truncate text-xs">{p.url}</span>
                        </ExternalA>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(p.text_length)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.http_status ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>
        <Section title="処理履歴">
          <ul className="space-y-2 text-sm">
            {[...crawlJobs.map((j) => ({ ...j, kind: "クロール" })), ...analysisJobs.map((j) => ({ ...j, kind: "AI分析" }))]
              .sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
              .slice(0, 8)
              .map((j) => (
                <li key={j.id} className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-medium">{j.kind}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{formatDate(j.created_at, true)}</span>
                    {j.error ? <div className="text-xs text-red-700">{j.error}</div> : null}
                  </div>
                  <JobStatusBadge status={j.status} />
                </li>
              ))}
            {crawlJobs.length === 0 && analysisJobs.length === 0 ? <li className="text-muted-foreground">履歴はありません</li> : null}
          </ul>
        </Section>
      </div>
    </div>
  );
}
