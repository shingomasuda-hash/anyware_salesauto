/**
 * 確認待ち（needs_review）の候補を、人を待たずに自動で判定する。
 *
 *   npm run db:auto-review            … 判定結果を表示するだけ
 *   npm run db:auto-review -- --apply … 昇格・見送りを実際に反映する
 *
 * 以前は 60〜79点の候補を /review で1件ずつ承認する設計だったが、
 * 実データでは半数近くがこの帯に入るため、自動化が人の作業速度で止まっていた。
 * 判断は「公式サイトを確認できているか」の一点に絞る。
 *
 * 新しい探索では discovery-job が同じ判定を自動で行う。
 * このスクリプトは、それ以前に溜まった確認待ちを片付けるためのもの。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";
import type { DiscoveryCandidateRow } from "../src/db/types";
import { updateCandidate, refreshDiscoveryRunCounts } from "../src/db/repositories/discovery";
import { decideAutoReview } from "../src/lib/discovery/auto-review";
import { promoteCandidate } from "../src/lib/discovery/promote";
import { Logger } from "../src/lib/logging/logger";

const apply = process.argv.includes("--apply");

async function main() {
  const db = getDb();
  const logger = new Logger(db, { category: "company" });

  const rows = await rawRows<DiscoveryCandidateRow>(
    db,
    sql`select * from discovery_candidates
        where status = 'needs_review' and company_id is null
        order by verification_score desc nulls last`,
  );

  if (rows.length === 0) {
    console.log("確認待ちの候補はありません。");
    return;
  }

  const decisions = rows.map((row) => ({
    row,
    decision: decideAutoReview({
      verificationScore: row.verification_score,
      officialSiteConfidence: row.official_site_confidence,
      website: row.website,
    }),
  }));

  const promote = decisions.filter((d) => d.decision.action === "promote");
  const reject = decisions.filter((d) => d.decision.action === "reject");

  console.log(`確認待ちの候補: ${rows.length}件`);
  console.log(`  昇格（公式サイト確認済み）: ${promote.length}件`);
  console.log(`  見送り（公式サイトを確認できず）: ${reject.length}件`);

  if (promote.length > 0) {
    console.log("\n■ 企業リストに追加する候補");
    for (const { row, decision } of promote.slice(0, 20)) {
      console.log(`  ${row.name}（${row.prefecture ?? "—"}）`);
      console.log(`    ${row.website}`);
      console.log(`    → ${decision.reason}`);
    }
    if (promote.length > 20) console.log(`  … 他 ${promote.length - 20}件`);
  }

  if (reject.length > 0) {
    console.log("\n■ 見送る候補（企業リストには追加しません）");
    for (const { row, decision } of reject.slice(0, 20)) {
      console.log(`  ${row.name}（${row.prefecture ?? "—"}） → ${decision.reason}`);
    }
    if (reject.length > 20) console.log(`  … 他 ${reject.length - 20}件`);
  }

  if (!apply) {
    console.log(`\n反映するには --apply を付けてください（例: npm run db:auto-review -- --apply）`);
    return;
  }

  const runIds = new Set<string>();
  let promoted = 0;
  let failed = 0;

  for (const { row, decision } of decisions) {
    if (row.run_id) runIds.add(row.run_id);
    try {
      if (decision.action === "promote") {
        await promoteCandidate(db, row, { websiteUrl: row.website, createdBy: "auto" }, logger);
        await updateCandidate(db, row.id, {
          status: "verified",
          reject_reason: null,
          reviewed_by: "auto",
          reviewed_at: new Date().toISOString(),
        });
        promoted++;
      } else {
        await updateCandidate(db, row.id, {
          status: "rejected",
          reject_reason: decision.reason.slice(0, 500),
          reviewed_by: "auto",
          reviewed_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ ${row.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 探索ランの集計を実データから引き直す
  for (const runId of runIds) await refreshDiscoveryRunCounts(db, runId);

  console.log(`\n${promoted}件を企業リストに追加し、${reject.length}件を見送りました。`);
  if (failed > 0) console.log(`${failed}件は処理に失敗しました（上のログを確認してください）。`);
  if (promoted > 0) console.log("追加した企業はクロール待ちです。maintain が続けて処理します。");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
