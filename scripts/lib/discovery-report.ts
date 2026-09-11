/**
 * 探索ラン（discovery_runs）の検証レポート。
 *
 * 企業ごとの取得結果・全体の精度指標・Provider 別の貢献度を出力する。
 * 「Multi-Source 化に実際の価値があったか」を Provider 単独発見数で判定できるようにする。
 */
import type { Db } from "../../src/db";
import type { CompanyRow, DiscoveryCandidateRow, DiscoveryRunRow } from "../../src/db/types";
import { getDiscoveryRun, listCandidatesByRun, listCompanySources, refreshDiscoveryRunCounts } from "../../src/db/repositories/discovery";
import { getCompanyDetail } from "../../src/lib/companies/queries";
import { PROVIDER_LABELS } from "../../src/lib/discovery/criteria";
import type { DiscoveryProviderName } from "../../src/lib/discovery/types";

const RULE = "─".repeat(78);

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}% (${n}/${d})`;
}

/** 候補の情報源一覧（空なら primary_source） */
function sourcesOf(c: DiscoveryCandidateRow): DiscoveryProviderName[] {
  const s = c.sources as DiscoveryProviderName[];
  return s.length > 0 ? s : [c.primary_source];
}

const VERDICT_LABEL: Record<string, string> = {
  verified: "確認済（企業登録）",
  needs_review: "要確認（未登録・承認待ち）",
  rejected: "対象外（未登録）",
  duplicate: "重複（登録済み企業）",
  failed: "失敗",
  discovered: "未確認",
  verifying: "確認中",
};

export async function reportDiscoveryRun(db: Db, runId: string): Promise<void> {
  const run = await getDiscoveryRun(db, runId);
  if (!run) throw new Error(`探索ランが見つかりません: ${runId}`);

  // 手動レビュー後などのズレを避けるため、集計は実データから引き直す
  const counts = await refreshDiscoveryRunCounts(db, runId);
  const candidates = await listCandidatesByRun(db, runId, undefined, 1000);

  await printPerCompany(db, candidates);
  printAggregates(run, counts, candidates);
  await printCompanyMetrics(db, candidates);
  await printProviderContribution(db, candidates);
  printSafetyChecks(candidates);
}

// ---------------------------------------------------------------------------
// 企業ごとの取得結果
// ---------------------------------------------------------------------------

async function printPerCompany(db: Db, candidates: DiscoveryCandidateRow[]): Promise<void> {
  console.log(`\n${RULE}\n【企業ごとの取得結果】\n${RULE}`);
  // 登録された企業を先に、次に要確認、最後に対象外
  const order = ["verified", "needs_review", "duplicate", "rejected", "failed"];
  const sorted = [...candidates].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (b.verification_score ?? 0) - (a.verification_score ?? 0),
  );

  let i = 0;
  for (const c of sorted) {
    i++;
    const detail = c.company_id ? await getCompanyDetail(db, c.company_id) : null;
    const company: CompanyRow | null = detail?.company ?? null;
    const a = detail?.analysis ?? null;
    const pages = detail?.pages ?? [];
    const evidence = detail?.evidence ?? [];
    const sns = company
      ? [
          company.instagram_url && "Instagram",
          company.facebook_url && "Facebook",
          company.x_url && "X",
          company.youtube_url && "YouTube",
          company.linkedin_url && "LinkedIn",
          company.tiktok_url && "TikTok",
        ].filter(Boolean)
      : [];

    console.log(`\n[${i}] ${c.name}`);
    console.log(`  法人番号            : ${c.corporate_number ?? "なし"}`);
    console.log(`  住所                : ${c.address ?? "不明"}`);
    console.log(`  発見Provider        : ${PROVIDER_LABELS[c.primary_source] ?? c.primary_source}`);
    console.log(`  Source一覧          : ${sourcesOf(c).map((s) => PROVIDER_LABELS[s] ?? s).join(" + ")}`);
    console.log(`  公式HP              : ${c.website ?? "なし"}`);
    console.log(`  official_site_conf  : ${c.official_site_confidence ?? "—"}`);
    console.log(`  Verification Score  : ${c.verification_score ?? "—"}`);
    console.log(`  Verification判定    : ${VERDICT_LABEL[c.status] ?? c.status}${c.reject_reason ? ` / ${c.reject_reason}` : ""}`);
    console.log(`  採用signal          : ${c.recruiting_signal}`);

    if (!company) {
      console.log("  （企業未登録のため、以降のクロール・AI分析の項目はありません）");
      continue;
    }
    console.log(`  採用ページ          : ${company.recruit_page_url ?? "なし"}`);
    console.log(`  問い合わせページ    : ${company.contact_page_url ?? company.contact_form_url ?? "なし"}`);
    console.log(`  公開メール          : ${company.email ?? "なし（推測生成はしません）"}`);
    console.log(`  電話                : ${company.phone ?? "なし"}`);
    console.log(`  SNS                 : ${sns.length > 0 ? sns.join(", ") : "なし"}`);
    console.log(
      `  営業可否            : ${company.sales_contact_allowed}` +
        (company.sales_contact_allowed === "false" ? `（${company.sales_restriction_text ?? "拒否表記あり"}）` : "") +
        (company.sales_contact_allowed === "unknown" ? "（未確認。営業可能として扱いません）" : ""),
    );
    console.log(`  クロールページ数    : ${pages.length}`);
    if (a) {
      console.log(`  AI分析              : ${(a.company_summary ?? "").slice(0, 60)}…`);
      console.log(`  営業ランク          : ${a.sales_priority_rank ?? "—"}（スコア ${a.sales_priority_score ?? "—"} / 信頼度 ${a.confidence_score ?? "—"}）`);
      console.log(`  Evidence            : ${evidence.length}件${evidence[0] ? ` 例) ${evidence[0].source_url}` : ""}`);
    } else {
      console.log(`  AI分析              : 未実施（analysis_status=${company.analysis_status}）`);
      console.log(`  営業ランク          : —`);
      console.log(`  Evidence            : 0件`);
    }
  }
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

function printAggregates(
  run: DiscoveryRunRow,
  counts: Awaited<ReturnType<typeof refreshDiscoveryRunCounts>>,
  candidates: DiscoveryCandidateRow[],
): void {
  console.log(`\n${RULE}\n【集計】\n${RULE}`);
  const { byStatus, discovered, total } = counts;

  console.log(`保存した候補        : 全${total}件 ＝ 新規候補 ${discovered}件 ＋ 重複 ${byStatus.duplicate}件`);
  console.log("  ※「重複」は既に企業一覧へ登録済みのため、新規候補数には含みません（別軸の集計）");
  console.log(`候補発見数（新規）  : ${discovered}`);
  console.log(`重複率              : ${pct(byStatus.duplicate, total)}  ← 全候補に占める既登録企業の割合`);
  console.log(`verified率          : ${pct(byStatus.verified, discovered)}`);
  console.log(`needs_review率      : ${pct(byStatus.needs_review, discovered)}`);
  console.log(`rejected率          : ${pct(byStatus.rejected, discovered)}`);
  console.log(`企業登録（昇格）    : ${counts.promoted}社 / 目標 ${run.requested_count}社`);

  // 公式HP関連は「本人確認まで進んだ候補」を母数にする
  const examined = candidates.filter((c) => c.status !== "duplicate" && c.verification_score !== null);
  const withSite = examined.filter((c) => Boolean(c.website));
  console.log(`\n公式HP取得率        : ${pct(withSite.length, examined.length)}  ← 本人確認を行った候補が母数`);

  // 「正解率」は自動判定できないため、社名一致シグナルを代理指標として出す
  const nameMatched = examined.filter((c) => {
    const signals = (Array.isArray(c.verification_signals) ? c.verification_signals : []) as { key: string; matched: boolean }[];
    return signals.some((s) => s.key === "website_name" && s.matched);
  });
  console.log(`公式HP正解率(代理)  : ${pct(nameMatched.length, withSite.length)}  ← サイト本文/タイトルに会社名が現れた割合`);
  console.log("  ※ 真の正解率は自動判定できません。下記「要目視確認」の企業を人が確認してください。");
  const suspicious = withSite.filter((c) => !nameMatched.includes(c));
  if (suspicious.length > 0) {
    console.log(`  要目視確認 ${suspicious.length}件:`);
    for (const c of suspicious.slice(0, 20)) console.log(`    - ${c.name} → ${c.website}（conf ${c.official_site_confidence ?? "—"}）`);
  }

  // クロール以降の指標は、企業登録された候補が母数
  const registered = candidates.filter((c) => c.status === "verified" && c.company_id);
  console.log(`\n（以下は企業登録された ${registered.length}社が母数）`);
}

/** 企業登録後の指標（company の実データが必要なので別関数） */
export async function printCompanyMetrics(db: Db, candidates: DiscoveryCandidateRow[]): Promise<void> {
  const registered = candidates.filter((c) => c.status === "verified" && c.company_id);
  const details = await Promise.all(registered.map((c) => getCompanyDetail(db, c.company_id!)));
  const companies = details.filter((d): d is NonNullable<typeof d> => Boolean(d));

  const has = (fn: (c: NonNullable<(typeof companies)[number]>) => boolean) => companies.filter(fn).length;
  const recruit = has((d) => Boolean(d.company.recruit_page_url));
  const contact = has((d) => Boolean(d.company.contact_page_url || d.company.contact_form_url || d.company.email));
  const sns = has((d) =>
    Boolean(
      d.company.instagram_url || d.company.facebook_url || d.company.x_url || d.company.youtube_url || d.company.linkedin_url || d.company.tiktok_url,
    ),
  );
  const analyzed = has((d) => Boolean(d.analysis));

  console.log(`採用ページ検出率    : ${pct(recruit, companies.length)}`);
  console.log(`問い合わせ取得率    : ${pct(contact, companies.length)}`);
  console.log(`SNS取得率           : ${pct(sns, companies.length)}`);
  console.log(`AI分析成功率        : ${pct(analyzed, companies.length)}`);

  // AI分析まで到達しなかった企業は、クロール段階で止まっていることが多い。
  // 原因が分かるよう、クロール状態の内訳と失敗理由を出す。
  const notAnalyzed = companies.filter((d) => !d.analysis);
  if (notAnalyzed.length > 0) {
    const byCrawl = notAnalyzed.reduce<Record<string, number>>((acc, d) => {
      const k = d.company.crawl_status;
      return { ...acc, [k]: (acc[k] ?? 0) + 1 };
    }, {});
    console.log(`  未分析 ${notAnalyzed.length}社のクロール状態: ${Object.entries(byCrawl).map(([k, v]) => `${k}=${v}`).join(" / ")}`);
    if (byCrawl.not_crawled) {
      console.log(`    ※ not_crawled はクロール失敗ではなく「ジョブ未処理」です。`);
      console.log(`      npm run jobs:run で残りを処理してから npm run discovery:verify で再確認できます`);
    }
    const failures = notAnalyzed
      .map((d) => ({ name: d.company.company_name, error: d.crawlJobs.find((j) => j.error)?.error ?? null }))
      .filter((f) => f.error);
    for (const f of failures.slice(0, 5)) console.log(`    - ${f.name}: ${(f.error ?? "").slice(0, 120)}`);
    if (failures.length > 5) console.log(`    … 他 ${failures.length - 5}件`);
  }

  const ranks = companies.map((d) => d.analysis?.sales_priority_rank).filter(Boolean) as string[];
  const dist = ranks.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {});
  console.log(`営業ランク分布      : ${["A", "B", "C", "D"].map((r) => `${r}=${dist[r] ?? 0}`).join(" / ")}`);

  const allowed = companies.reduce<Record<string, number>>((acc, d) => {
    const k = d.company.sales_contact_allowed;
    return { ...acc, [k]: (acc[k] ?? 0) + 1 };
  }, {});
  console.log(`営業可否            : 可=${allowed.true ?? 0} / 不可=${allowed.false ?? 0} / 不明=${allowed.unknown ?? 0}`);
}

// ---------------------------------------------------------------------------
// Provider 別の貢献度
// ---------------------------------------------------------------------------

async function printProviderContribution(db: Db, candidates: DiscoveryCandidateRow[]): Promise<void> {
  console.log(`\n${RULE}\n【Provider別の貢献】\n${RULE}`);

  const discoveryProviders: DiscoveryProviderName[] = ["gbiz", "google_places", "web_search", "edinet"];
  const newOnes = candidates.filter((c) => c.status !== "duplicate");

  console.log("Provider別 新規企業数（その情報源が発見に関与した候補）:");
  for (const p of discoveryProviders) {
    const involved = newOnes.filter((c) => sourcesOf(c).includes(p));
    const verified = involved.filter((c) => c.status === "verified");
    console.log(`  ${(PROVIDER_LABELS[p] ?? p).padEnd(16)} 関与 ${String(involved.length).padStart(3)}件 / うち確認済 ${verified.length}件`);
  }

  console.log("\n単独発見（その情報源が無ければ見つからなかった企業）:");
  const exclusive: Record<string, DiscoveryCandidateRow[]> = {};
  for (const p of discoveryProviders) {
    exclusive[p] = newOnes.filter((c) => {
      const s = sourcesOf(c).filter((x) => discoveryProviders.includes(x));
      return s.length === 1 && s[0] === p;
    });
  }
  for (const p of discoveryProviders) {
    const list = exclusive[p];
    const verified = list.filter((c) => c.status === "verified");
    console.log(`  ${(PROVIDER_LABELS[p] ?? p).padEnd(16)} ${String(list.length).padStart(3)}件（うち確認済 ${verified.length}件）`);
    for (const c of list.slice(0, 5)) console.log(`      - ${c.name}（${VERDICT_LABEL[c.status] ?? c.status}）`);
    if (list.length > 5) console.log(`      … 他 ${list.length - 5}件`);
  }

  const multi = newOnes.filter((c) => sourcesOf(c).filter((x) => discoveryProviders.includes(x)).length >= 2);
  console.log(`\n複数ソースで一致    : ${pct(multi.length, newOnes.length)}  ← 突き合わせが効いた候補`);

  // Multi-Source 化の価値判定
  const gbizOnlyExclusive = exclusive.gbiz?.length ?? 0;
  const otherExclusive = (exclusive.google_places?.length ?? 0) + (exclusive.web_search?.length ?? 0) + (exclusive.edinet?.length ?? 0);
  console.log(`\n判定: GビズINFO以外の情報源が単独で見つけた企業 = ${otherExclusive}件`);
  if (otherExclusive === 0) {
    console.log("  → 今回の条件では Multi-Source 化の上積みがありませんでした（GビズINFO だけで足りた）。");
  } else {
    console.log(`  → GビズINFO 単独運用では ${otherExclusive}件を取りこぼしていました（Multi-Source 化に効果あり）。`);
  }
  console.log(`  （参考: GビズINFO のみで見つかった企業 = ${gbizOnlyExclusive}件）`);

  // 情報源の記録が企業側にも残っているか
  const registered = candidates.filter((c) => c.status === "verified" && c.company_id).slice(0, 3);
  if (registered.length > 0) {
    console.log("\ncompany_sources の記録例:");
    for (const c of registered) {
      const sources = await listCompanySources(db, c.company_id!);
      console.log(`  ${c.name}: ${sources.map((s) => `${PROVIDER_LABELS[s.provider] ?? s.provider}(${s.confidence})`).join(", ") || "なし"}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 安全設計の検査
// ---------------------------------------------------------------------------

function printSafetyChecks(candidates: DiscoveryCandidateRow[]): void {
  console.log(`\n${RULE}\n【安全設計の検査】\n${RULE}`);
  const checks: { label: string; ok: boolean; detail: string }[] = [];

  // 1) Web検索単独の候補を自動登録していないか
  const webOnlyRegistered = candidates.filter((c) => {
    const s = sourcesOf(c).filter((x) => x !== "official_web");
    return s.length === 1 && s[0] === "web_search" && c.status === "verified" && !c.reviewed_at;
  });
  checks.push({
    label: "Web検索単独の候補を自動登録していない",
    ok: webOnlyRegistered.length === 0,
    detail: webOnlyRegistered.length === 0 ? "該当なし" : `${webOnlyRegistered.length}件が自動登録されています: ${webOnlyRegistered.map((c) => c.name).join(", ")}`,
  });

  // 2) 本人確認を通っていない候補が企業登録されていないか
  const unverifiedRegistered = candidates.filter((c) => c.company_id && !["verified", "duplicate"].includes(c.status));
  checks.push({
    label: "本人確認を通らない候補を企業登録していない",
    ok: unverifiedRegistered.length === 0,
    detail: unverifiedRegistered.length === 0 ? "該当なし" : `${unverifiedRegistered.length}件: ${unverifiedRegistered.map((c) => `${c.name}(${c.status})`).join(", ")}`,
  });

  // 3) しきい値未満の候補が verified になっていないか
  const belowThreshold = candidates.filter((c) => c.status === "verified" && (c.verification_score ?? 0) < 80 && !c.reviewed_at);
  checks.push({
    label: "しきい値未満の候補を自動で確認済にしていない",
    ok: belowThreshold.length === 0,
    detail: belowThreshold.length === 0 ? "該当なし" : `${belowThreshold.length}件: ${belowThreshold.map((c) => `${c.name}(${c.verification_score})`).join(", ")}`,
  });

  // 4) スコアが 0-100 に収まっているか
  const outOfRange = candidates.filter((c) => c.verification_score !== null && (c.verification_score < 0 || c.verification_score > 100));
  checks.push({
    label: "Verification Score が 0-100 に収まっている",
    ok: outOfRange.length === 0,
    detail: outOfRange.length === 0 ? "該当なし" : `${outOfRange.length}件が範囲外`,
  });

  for (const c of checks) console.log(`${c.ok ? "✅" : "❌"} ${c.label}: ${c.detail}`);
  const failed = checks.filter((c) => !c.ok);
  console.log(failed.length === 0 ? "\nすべての安全検査を通過しました。" : `\n${failed.length}件の検査に失敗しました。`);
}
