/**
 * 既に候補URLを持っている候補を、現在の判定基準でやり直す。
 *
 *   npm run db:reverify              … 何件通るようになるかを数えるだけ
 *   npm run db:reverify -- --apply   … 通ったものを企業リストへ追加する
 *   npm run db:reverify -- --limit 50
 *
 * 公式サイトの判定はクロール・探索のときにしか走らないため、
 * 判定を直しても既存の候補には反映されない。
 * 配点の修正（ドメインの持ち主の確認で+10点）と名簿ページの除外が
 * 実データで何件を動かすのかを、ここで測る。
 *
 * **Web検索は走らない。** 候補URLを既に持っている候補だけを対象にするため、
 * Brave Search の費用はかからない（HTTPでページを取得するだけ）。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";
import { warnIfBehindRemote } from "./lib/git-freshness";
import type { DiscoveryCandidateRow } from "../src/db/types";
import { updateCandidate, refreshDiscoveryRunCounts } from "../src/db/repositories/discovery";
import { createBudgetTracker } from "../src/lib/discovery/budget";
import { getOfficialWebProvider } from "../src/lib/discovery/providers";
import { promoteCandidate, rowToMerged } from "../src/lib/discovery/promote";
import { verifyCandidate } from "../src/lib/discovery/verifier";
import { rejectOfficialSiteUrl } from "../src/lib/companies/official-site";
import { normalizeUrl } from "../src/lib/companies/normalize";
import type { DiscoveryContext } from "../src/lib/discovery/types";
import type { Json } from "../src/db/types";
import { Logger } from "../src/lib/logging/logger";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const apply = process.argv.includes("--apply");
const limit = Math.max(1, Number(arg("limit") ?? 200));

async function main() {
  await warnIfBehindRemote();
  const db = getDb();
  const logger = new Logger(db, { category: "company" });

  const rows = await rawRows<DiscoveryCandidateRow>(
    db,
    sql`select * from discovery_candidates
        where company_id is null
          and status in ('needs_review', 'rejected')
        order by official_site_confidence desc nulls last
        limit ${limit}`,
  );

  // 候補URLを持っているものだけを対象にする（持っていないと Web 検索が走り費用がかかる）
  const targets = rows.filter((row) => {
    const merged = rowToMerged(row);
    return merged.observations.some((o) => {
      const url = normalizeUrl(o.website);
      return url && !rejectOfficialSiteUrl(url);
    });
  });

  console.log(`対象の候補: ${rows.length}件`);
  console.log(`うち候補URLを持つもの: ${targets.length}件（これだけを再判定します。Web検索は走りません）`);
  if (targets.length === 0) return;

  const officialWeb = getOfficialWebProvider();
  // Web 検索を絶対に走らせないため、探索リクエストの上限を 0 にする
  const budget = {
    maxProviderRequests: 0,
    maxCandidates: 0,
    maxVerificationRequests: targets.length * 4,
    maxCrawlPages: 0,
    maxAiCalls: 0,
    maxExecutionMinutes: 120,
  };
  const context: DiscoveryContext = {
    runId: "reverify",
    criteria: { recruitingRequired: false, websiteRequired: true, maxResults: targets.length },
    budget: createBudgetTracker(budget),
    deadline: Date.now() + 120 * 60_000,
    log: async () => {},
  };

  let nowVerified = 0;
  let stillShort = 0;
  let excluded = 0;
  const promoted: string[] = [];
  // 結果が 0 件でも理由が分かるように内訳を残す（数字だけだと原因を特定できない）
  const reasonTally = new Map<string, number>();
  const scoreTally = new Map<string, number>();
  const shortExamples: { name: string; url: string; before: number; after: number; reasons: string[] }[] = [];
  const countUp = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  const bucket = (score: number) => {
    if (score === 0) return "0点（ページを読めていない）";
    if (score < 20) return "1-19点";
    if (score < 40) return "20-39点";
    if (score < 60) return "40-59点（あと少し）";
    return "60点以上";
  };

  for (const [i, row] of targets.entries()) {
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${targets.length}件`);
    const merged = rowToMerged(row);
    let check;
    try {
      check = await officialWeb.checkOfficialSite(merged, context);
    } catch {
      stillShort++;
      continue;
    }

    const before = row.official_site_confidence ?? 0;
    const after = check.confidence ?? 0;

    for (const reason of check.reasons) countUp(reasonTally, reason);
    countUp(scoreTally, bucket(check.confidence ?? 0));

    if (!check.url) {
      excluded++;
      if (apply) {
        await updateCandidate(db, row.id, {
          status: "rejected",
          official_site_confidence: after,
          reject_reason: (check.reasons[0] ?? "公式サイトを確認できませんでした").slice(0, 500),
        });
      }
      continue;
    }

    const verification = verifyCandidate(merged, {
      websiteText: check.text,
      websiteTitle: check.title,
      officialSiteConfidence: check.confidence,
    });

    if (check.status === "verified") {
      nowVerified++;
      console.log(`  ◎ ${row.name}: ${before}点 → ${after}点  ${check.url}`);
      console.log(`      ${check.reasons.join(" / ")}`);
      if (apply) {
        await promoteCandidate(db, { ...row, website: check.url }, { websiteUrl: check.url, createdBy: "reverify" }, logger);
        await updateCandidate(db, row.id, {
          status: "verified",
          website: check.url,
          domain: check.domain,
          verification_score: verification.score,
          verification_signals: verification.signals as unknown as Json,
          official_site_confidence: after,
          reject_reason: null,
          reviewed_by: "reverify",
          reviewed_at: new Date().toISOString(),
        });
        promoted.push(row.name);
      }
    } else {
      stillShort++;
      if (shortExamples.length < 10) shortExamples.push({ name: row.name, url: check.url, before, after, reasons: check.reasons });
      if (apply) {
        await updateCandidate(db, row.id, {
          status: "rejected",
          website: check.url,
          domain: check.domain,
          official_site_confidence: after,
          reject_reason: `信頼度が不足（${after}点 / 60点必要）`.slice(0, 500),
        });
      }
    }
  }

  console.log(`\n--- 再判定の結果（${targets.length}件）---`);
  console.log(`  公式サイトを確定できた:     ${nowVerified}件  ← 修正で取り戻せた分`);
  console.log(`  まだ信頼度が足りない:       ${stillShort}件`);
  console.log(`  名簿・ポータルとして除外:   ${excluded}件`);
  const rate = targets.length > 0 ? ((nowVerified / targets.length) * 100).toFixed(1) : "0.0";
  console.log(`  回収率: ${rate}%`);

  const sorted = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n■ 判定後の信頼度`);
  for (const [label, count] of sorted(scoreTally)) console.log(`  ${String(count).padStart(4)}件  ${label}`);
  console.log(`\n■ 取れた加点・落ちた理由`);
  for (const [label, count] of sorted(reasonTally)) console.log(`  ${String(count).padStart(4)}件  ${label}`);

  if (shortExamples.length > 0) {
    console.log(`\n■ まだ足りないものの例（何点足りないかを見る）`);
    for (const e of shortExamples) {
      console.log(`  ${e.name}: ${e.before}点 → ${e.after}点（60点必要）`);
      console.log(`      ${e.url}`);
      console.log(`      ${e.reasons.join(" / ") || "（加点なし）"}`);
    }
  }

  if (!apply) {
    console.log(`\n企業リストに追加するには --apply を付けてください（例: npm run db:reverify -- --apply）`);
    return;
  }

  const runIds = new Set(targets.map((r) => r.run_id).filter((id): id is string => Boolean(id)));
  for (const runId of runIds) await refreshDiscoveryRunCounts(db, runId);
  console.log(`\n${promoted.length}社を企業リストに追加しました。`);
  if (promoted.length > 0) console.log("次に実行: npm run maintain -- --apply（クロールと採用状況の判定を行います）");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
