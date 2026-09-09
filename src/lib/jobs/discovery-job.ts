import type { Db } from "@/db";
import type { DiscoveryCandidateInsert, DiscoveryCandidateRow, DiscoveryRunRow, Json } from "@/db/types";
import {
  claimCandidatesForVerification,
  countCandidatesByStatus,
  findKnownMatches,
  insertCandidates,
  listCandidatesByRun,
  listPromotableCandidates,
  updateCandidate,
  updateDiscoveryRun,
} from "@/db/repositories/discovery";
import { getDiscoveryConfig, scaleBudgetForRequest } from "@/lib/config/discovery";
import { normalizeAddress } from "@/lib/companies/normalize";
import { aggregateCandidates } from "@/lib/discovery/aggregator";
import { createBudgetTracker, emptyProviderStat, mergeProviderStats } from "@/lib/discovery/budget";
import { toMerged } from "@/lib/discovery/deduplicator";
import { promoteCandidate, rowToMerged } from "@/lib/discovery/promote";
import { planFallbackQueries, planQueries } from "@/lib/discovery/query-planner";
import { getOfficialWebProvider, resolveProviders } from "@/lib/discovery/providers";
import { detectRecruitingSignal } from "@/lib/discovery/signals";
import { matchesCriteria, verifyCandidate } from "@/lib/discovery/verifier";
import type {
  CompanyDiscoveryProvider,
  DiscoveryCandidate,
  DiscoveryContext,
  DiscoveryCriteria,
  DiscoveryMode,
  MergedCandidate,
  ProviderStats,
} from "@/lib/discovery/types";
import { Logger, serializeError } from "@/lib/logging/logger";
import type { StepOutcome } from "./search-job";

/** 1 ステップで検証する候補数（HTTP 実行時間を超えないように分割する） */
const VERIFY_BATCH = 8;
/** 1 ステップで昇格させる候補数 */
const PROMOTE_BATCH = 15;

interface DiscoveryCursor {
  /** 実行済みクエリ数（planQueries の並び順に対応） */
  queryIndex?: number;
  executedQueryIds?: string[];
  /** 不足分の追加探索をすでに計画したか */
  fallbackPlanned?: boolean;
  /** 予算の消費量（ステップをまたいで持ち越す） */
  usage?: { providerRequests: number; candidates: number; verificationRequests: number; startedAt: number };
  stoppedReason?: string;
}

/**
 * Discovery Run を 1 ステップ進める。
 * discovering → verifying → promoting → done の順に処理し、
 * 時間切れ・予算切れの場合は途中経過を保存して "continue" を返す（次回呼び出しで再開）。
 *
 * 重要: 検索結果に出た企業をそのまま companies に入れない。
 * 必ず discovery_candidates に貯めて Verification を通し、verified になったものだけ昇格させる。
 */
export async function processDiscoveryRunStep(db: Db, run: DiscoveryRunRow, logger: Logger, deadline: number): Promise<StepOutcome> {
  const cfg = getDiscoveryConfig();
  const criteria = normalizeCriteria(run.criteria, run.requested_count);
  const budget = scaleBudgetForRequest(cfg.budget, run.requested_count);
  const cursor = (run.cursor ?? {}) as DiscoveryCursor;
  const tracker = createBudgetTracker(budget, cursor.usage);

  const context: DiscoveryContext = {
    runId: run.id,
    criteria,
    budget: tracker,
    deadline,
    log: async (level, message, meta) => {
      await logger[level](message, meta);
    },
  };

  if (!run.started_at) {
    await updateDiscoveryRun(db, run.id, { started_at: new Date().toISOString(), budget: budget as unknown as Json });
    await logger.info("企業探索を開始", { mode: run.mode, criteria, budget });
  }

  const phase = run.phase;
  try {
    if (phase === "discovering") return await runDiscoveringPhase(db, run, criteria, cursor, context, logger);
    if (phase === "verifying") return await runVerifyingPhase(db, run, criteria, cursor, context, logger);
    if (phase === "promoting") return await runPromotingPhase(db, run, criteria, logger, deadline);
    return "completed";
  } finally {
    // 予算の消費量は成否にかかわらず保存する（再試行で API を撃ち直さない）
    await updateDiscoveryRun(db, run.id, { cursor: { ...cursor, usage: tracker.usage } as unknown as Json });
  }
}

// ---------------------------------------------------------------------------
// Phase 1: discovering
// ---------------------------------------------------------------------------

async function runDiscoveringPhase(
  db: Db,
  run: DiscoveryRunRow,
  criteria: DiscoveryCriteria,
  cursor: DiscoveryCursor,
  context: DiscoveryContext,
  logger: Logger,
): Promise<StepOutcome> {
  const cfg = getDiscoveryConfig();
  const { providers, skipped } = resolveProviders(run.mode as DiscoveryMode);
  let stats: ProviderStats = (run.provider_stats ?? {}) as ProviderStats;

  // 未設定の Provider は探索全体を止めず、理由を記録して skip する
  for (const s of skipped) {
    stats = mergeProviderStats(stats, { [s.name]: { ...emptyProviderStat(), skipped: true, unavailableReason: s.reason } });
  }
  if (providers.length === 0) {
    await logger.error("利用できる探索 Provider がありません", { skipped });
    await updateDiscoveryRun(db, run.id, {
      status: "failed",
      phase: "done",
      provider_stats: stats as unknown as Json,
      error: `利用できる探索 Provider がありません: ${skipped.map((s) => `${s.name}(${s.reason})`).join(", ")}`,
      completed_at: new Date().toISOString(),
      locked_at: null,
    });
    return "failed";
  }

  const planned = planQueries(criteria, providers);
  const startIndex = cursor.queryIndex ?? 0;
  const executed = cursor.executedQueryIds ?? [];

  // すでに保存済みの候補を種にして、ステップをまたいでも重複排除が効くようにする
  const stored = await listCandidatesByRun(db, run.id, undefined, cfg.budget.maxCandidates);
  const seed = stored.map(rowToMerged);

  let batch = planned.slice(startIndex, startIndex + cfg.queriesPerStep);
  let usingFallback = false;
  if (batch.length === 0) {
    // 計画済みクエリを使い切った。目標に届いていなければ 1 度だけ追加探索する
    const shortfall = run.requested_count - seed.length;
    if (!cursor.fallbackPlanned && shortfall > 0 && context.budget.canProviderRequest()) {
      batch = planFallbackQueries(criteria, providers, executed, shortfall);
      usingFallback = true;
      cursor.fallbackPlanned = true;
    }
  }

  if (batch.length === 0) {
    await logger.info("候補の発見を完了", { discovered: seed.length, requested: run.requested_count });
    await updateDiscoveryRun(db, run.id, {
      phase: "verifying",
      discovered_count: seed.length,
      provider_stats: stats as unknown as Json,
      cursor: { ...cursor, queryIndex: startIndex } as unknown as Json,
    });
    return "continue";
  }

  const result = await aggregateCandidates(batch, providers, context, seed);
  stats = mergeProviderStats(stats, result.stats);

  // 新規に見つかった候補だけを保存する（seed は保存済み）
  const fresh = result.merged.slice(seed.length);
  const saved = await persistCandidates(db, run.id, fresh, logger);

  if (!usingFallback) cursor.queryIndex = startIndex + batch.length;
  cursor.executedQueryIds = [...executed, ...result.executedQueryIds].slice(-500);
  cursor.stoppedReason = result.stoppedReason;

  const discovered = seed.length + saved.discovered;
  await updateDiscoveryRun(db, run.id, {
    discovered_count: discovered,
    duplicate_count: run.duplicate_count + saved.duplicate,
    provider_stats: stats as unknown as Json,
    cursor: { ...cursor, usage: context.budget.usage } as unknown as Json,
  });
  await logger.info("候補を取得", {
    queries: batch.length,
    new: saved.discovered,
    duplicate: saved.duplicate,
    total: discovered,
    stoppedReason: result.stoppedReason,
  });

  const exhausted = context.budget.exhaustedReason();
  const enough = discovered >= run.requested_count;
  if (exhausted || enough) {
    if (exhausted) await logger.warn("探索の予算に達したため発見フェーズを終了", { reason: exhausted });
    await updateDiscoveryRun(db, run.id, { phase: "verifying", discovered_count: discovered, provider_stats: stats as unknown as Json });
  }
  return "continue";
}

/**
 * 候補を discovery_candidates へ保存する。
 * 既知の企業（companies）と一致するものは duplicate として保存し、companies には触れない。
 */
async function persistCandidates(
  db: Db,
  runId: string,
  candidates: MergedCandidate[],
  logger: Logger,
): Promise<{ discovered: number; duplicate: number }> {
  if (candidates.length === 0) return { discovered: 0, duplicate: 0 };

  const known = await findKnownMatches(db, {
    corporateNumbers: unique(candidates.map((c) => c.corporateNumber)),
    domains: unique(candidates.map((c) => c.domain)),
    normalizedNames: unique(candidates.map((c) => c.normalizedName)),
  });
  const byCorp = new Map(known.companyIds.filter((c) => c.corporate_number).map((c) => [c.corporate_number!, c]));
  const byDomain = new Map(known.companyIds.filter((c) => c.website_domain).map((c) => [c.website_domain!, c]));
  const byName = new Map(known.companyIds.map((c) => [`${c.company_name_normalized}|${(c.address_normalized ?? "").slice(0, 12)}`, c]));

  const rows: DiscoveryCandidateInsert[] = candidates.map((c) => {
    const addrKey = (normalizeAddress(c.address) ?? "").slice(0, 12);
    const existing =
      (c.corporateNumber ? byCorp.get(c.corporateNumber) : undefined) ??
      (c.domain ? byDomain.get(c.domain) : undefined) ??
      (addrKey ? byName.get(`${c.normalizedName}|${addrKey}`) : undefined);
    return {
      run_id: runId,
      name: c.name,
      normalized_name: c.normalizedName,
      address: c.address,
      address_normalized: normalizeAddress(c.address),
      prefecture: c.prefecture,
      city: c.city,
      phone: c.phone,
      website: c.website,
      domain: c.domain,
      corporate_number: c.corporateNumber,
      industry: c.industry,
      primary_source: c.source,
      sources: c.sources,
      source_confidence: c.sourceConfidence,
      status: existing ? "duplicate" : "discovered",
      reject_reason: existing ? "既に登録済みの企業" : null,
      company_id: existing?.id ?? null,
      raw_data: { observations: c.observations } as unknown as Json,
    };
  });

  try {
    await insertCandidates(db, rows);
  } catch (err) {
    await logger.error("候補の保存に失敗", serializeError(err));
    throw err;
  }
  const duplicate = rows.filter((r) => r.status === "duplicate").length;
  return { discovered: rows.length - duplicate, duplicate };
}

// ---------------------------------------------------------------------------
// Phase 2: verifying
// ---------------------------------------------------------------------------

async function runVerifyingPhase(
  db: Db,
  run: DiscoveryRunRow,
  criteria: DiscoveryCriteria,
  cursor: DiscoveryCursor,
  context: DiscoveryContext,
  logger: Logger,
): Promise<StepOutcome> {
  const pending = await claimCandidatesForVerification(db, run.id, VERIFY_BATCH);
  if (pending.length === 0) {
    const counts = await countCandidatesByStatus(db, run.id);
    await logger.info("本人確認を完了", counts);
    await updateDiscoveryRun(db, run.id, {
      phase: "promoting",
      verified_count: counts.verified,
      needs_review_count: counts.needs_review,
      rejected_count: counts.rejected,
      duplicate_count: counts.duplicate,
    });
    return "continue";
  }

  const officialWeb = getOfficialWebProvider();
  const { providers } = resolveProviders(run.mode as DiscoveryMode);
  const gbiz = providers.find((p) => p.name === "gbiz");
  let stats: ProviderStats = (run.provider_stats ?? {}) as ProviderStats;

  for (const row of pending) {
    if (Date.now() > context.deadline) break;
    await updateCandidate(db, row.id, { status: "verifying" });
    try {
      const outcome = await verifyOne(db, row, criteria, context, officialWeb, gbiz);
      stats = mergeProviderStats(stats, outcome.stats);
    } catch (err) {
      await logger.warn("候補の本人確認に失敗", { candidate: row.name, ...serializeError(err) });
      await updateCandidate(db, row.id, { status: "failed", reject_reason: err instanceof Error ? err.message.slice(0, 500) : String(err) });
    }
  }

  const counts = await countCandidatesByStatus(db, run.id);
  await updateDiscoveryRun(db, run.id, {
    verified_count: counts.verified,
    needs_review_count: counts.needs_review,
    rejected_count: counts.rejected,
    provider_stats: stats as unknown as Json,
    cursor: { ...cursor, usage: context.budget.usage } as unknown as Json,
  });
  return "continue";
}

async function verifyOne(
  db: Db,
  row: DiscoveryCandidateRow,
  criteria: DiscoveryCriteria,
  context: DiscoveryContext,
  officialWeb: ReturnType<typeof getOfficialWebProvider>,
  gbiz: CompanyDiscoveryProvider | undefined,
): Promise<{ stats: ProviderStats }> {
  const stats: ProviderStats = {};
  let merged = rowToMerged(row);

  // 条件に合わない候補は公式サイトを取得する前に落とす（無駄なアクセスをしない）
  const criteriaMatch = matchesCriteria(merged, criteria);
  if (!criteriaMatch.ok) {
    await updateCandidate(db, row.id, { status: "rejected", verification_score: 0, reject_reason: criteriaMatch.reason ?? "検索条件と一致しません" });
    return { stats };
  }

  // 法人番号は Source of Truth。未確定なら GビズINFO で確定させる
  if (!merged.corporateNumber && gbiz?.enrich) {
    const stat = (stats.gbiz ??= emptyProviderStat());
    try {
      const found = await gbiz.enrich(merged, context);
      stat.requestCount += 1;
      if (found) {
        merged = mergeObservation(merged, found);
        stat.resultCount += 1;
      }
    } catch (err) {
      stat.failedCount += 1;
      await context.log("warn", "法人番号の確認に失敗しました", { candidate: merged.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // 公式サイト確認（検索結果のトップ URL を無条件に公式サイトとしない）
  const officialStat = (stats.official_web ??= emptyProviderStat());
  officialStat.requestCount += 1;
  const check = await officialWeb.checkOfficialSite(merged, context);
  if (check.url) {
    officialStat.resultCount += 1;
    merged = { ...merged, website: check.url, domain: check.domain ?? merged.domain };
  }

  if (criteria.websiteRequired && !check.url) {
    await updateCandidate(db, row.id, {
      status: "rejected",
      verification_score: 0,
      official_site_confidence: check.confidence,
      reject_reason: "公式サイトを確認できませんでした",
    });
    return { stats };
  }

  const verification = verifyCandidate(merged, {
    websiteText: check.text,
    websiteTitle: check.title,
    officialSiteConfidence: check.confidence,
  });

  // 採用シグナルは公式サイト本文から機械的に判定する（推測しない）
  const recruiting = check.text ? detectRecruitingSignal([{ url: check.url ?? "", text: check.text }]) : "unknown";

  if (verification.status === "verified") officialStat.verifiedCount += 1;

  await updateCandidate(db, row.id, {
    status: verification.status,
    verification_score: verification.score,
    verification_signals: verification.signals as unknown as Json,
    official_site_confidence: check.confidence,
    recruiting_signal: recruiting,
    website: merged.website,
    domain: merged.domain,
    corporate_number: merged.corporateNumber,
    sources: merged.sources,
    reject_reason: verification.status === "rejected" ? `本人確認スコアが不足（${verification.score}点）: ${verification.unmatched.join(" / ")}` : null,
    raw_data: { observations: merged.observations, officialSite: { url: check.url, reasons: check.reasons } } as unknown as Json,
  });
  return { stats };
}

// ---------------------------------------------------------------------------
// Phase 3: promoting
// ---------------------------------------------------------------------------

async function runPromotingPhase(db: Db, run: DiscoveryRunRow, criteria: DiscoveryCriteria, logger: Logger, deadline: number): Promise<StepOutcome> {
  // 依頼件数を超えて昇格させない（余分なクロール・AI 分析を発生させない）
  const remaining = Math.max(0, run.requested_count - run.promoted_count);
  const rows = remaining > 0 ? await listPromotableCandidates(db, run.id, Math.min(PROMOTE_BATCH, remaining)) : [];
  if (rows.length === 0) {
    const counts = await countCandidatesByStatus(db, run.id);
    // 目標件数に届いていれば、途中で予算上限に達していても「完了」とする
    const partial = counts.verified < run.requested_count && run.promoted_count < run.requested_count;
    await updateDiscoveryRun(db, run.id, {
      phase: "done",
      status: partial ? "partially_completed" : "completed",
      verified_count: counts.verified,
      needs_review_count: counts.needs_review,
      rejected_count: counts.rejected,
      duplicate_count: counts.duplicate,
      completed_at: new Date().toISOString(),
      locked_at: null,
      error: null,
    });
    await logger.info("企業探索が完了", { ...counts, promoted: run.promoted_count, requested: run.requested_count });
    return "completed";
  }

  const companyLogger = logger.child({ category: "company" });
  let promoted = run.promoted_count;
  for (const row of rows) {
    if (Date.now() > deadline) break;
    try {
      const result = await promoteCandidate(
        db,
        row,
        {
          recruitingRequired: criteria.recruitingRequired,
          industryFallback: criteria.industry ?? null,
          createdBy: run.created_by,
        },
        companyLogger,
      );
      // 既存企業と一致した場合も「営業候補として確定した」件数に数える（重複登録はしていない）
      promoted += 1;
      if (!result.created) await logger.info("既に登録済みの企業に紐づけ", { candidate: row.name, companyId: result.companyId });
    } catch (err) {
      await logger.error("候補の昇格に失敗", { candidate: row.name, ...serializeError(err) });
      await updateCandidate(db, row.id, { status: "failed", reject_reason: err instanceof Error ? err.message.slice(0, 500) : String(err) });
    }
  }

  await updateDiscoveryRun(db, run.id, { promoted_count: promoted });
  await logger.info("営業候補企業へ昇格", { promoted, batch: rows.length });
  return "continue";
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** enrich で得た観測を既存候補にマージする（上書きせず、欠けている項目だけ埋める） */
function mergeObservation(base: MergedCandidate, incoming: DiscoveryCandidate): MergedCandidate {
  const next = toMerged(base);
  return {
    ...next,
    corporateNumber: base.corporateNumber ?? incoming.corporateNumber,
    address: base.address ?? incoming.address,
    prefecture: base.prefecture ?? incoming.prefecture,
    city: base.city ?? incoming.city,
    phone: base.phone ?? incoming.phone,
    website: base.website ?? incoming.website,
    domain: base.domain ?? incoming.domain,
    industry: base.industry ?? incoming.industry,
    observations: [...base.observations, incoming],
    sources: unique([...base.sources, incoming.source]),
  };
}

function normalizeCriteria(raw: Json, requestedCount: number): DiscoveryCriteria {
  const c = (raw ?? {}) as Partial<DiscoveryCriteria>;
  return {
    ...c,
    recruitingRequired: c.recruitingRequired ?? false,
    websiteRequired: c.websiteRequired ?? true,
    maxResults: c.maxResults ?? requestedCount,
  };
}

function unique<T>(values: (T | null | undefined)[]): T[] {
  return Array.from(new Set(values.filter((v): v is T => v !== null && v !== undefined && v !== ("" as unknown as T))));
}
