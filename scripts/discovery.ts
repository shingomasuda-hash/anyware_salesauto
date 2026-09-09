/**
 * Multi-Source Discovery の実行 CLI。
 *   npm run discovery -- --prefecture 大阪府 --industry manufacturing --count 20 --mode hybrid
 * DATA_MODE=mock ならモック Provider、real なら実 API を使う（APIキーは .env.local から読む）。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getDb } from "../src/db";
import { countCandidatesByStatus, getDiscoveryRun, listCandidatesByRun } from "../src/db/repositories/discovery";
import { getDataMode } from "../src/lib/config/env";
import { getProviderAvailability } from "../src/lib/discovery/providers";
import type { DiscoveryCriteria, DiscoveryMode } from "../src/lib/discovery/types";
import { createDiscoveryRun } from "../src/lib/jobs/enqueue";
import { processJobs } from "../src/lib/jobs/runner";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const db = getDb();
  const criteria: DiscoveryCriteria = {
    prefecture: arg("prefecture", "大阪府"),
    city: arg("city"),
    industry: arg("industry", "manufacturing"),
    industrySubcategory: arg("subcategory"),
    employeeMin: arg("employeeMin") ? Number(arg("employeeMin")) : undefined,
    employeeMax: arg("employeeMax") ? Number(arg("employeeMax")) : undefined,
    keywords: arg("keywords")?.split(",").filter(Boolean),
    recruitingRequired: arg("recruiting") === "true",
    websiteRequired: arg("website") !== "false",
    maxResults: Number(arg("count", "20")),
  };
  const mode = arg("mode") as DiscoveryMode | undefined;

  console.log(`[discovery] DATA_MODE=${getDataMode()} mode=${mode ?? "(env)"} `);
  for (const p of getProviderAvailability()) {
    console.log(`[discovery] provider ${p.name}: ${p.available ? "利用可" : `利用不可 (${p.reason})`}`);
  }

  const runId = await createDiscoveryRun(db, criteria, { name: `${criteria.prefecture ?? ""} / ${criteria.industry ?? ""} / ${criteria.maxResults}社`, mode });
  console.log(`[discovery] run created: ${runId}`);

  for (let i = 0; i < 40; i++) {
    const stats = await processJobs({ db, maxRuntimeMs: 55_000 });
    const run = await getDiscoveryRun(db, runId);
    console.log(
      `[discovery] pass ${i + 1}: phase=${run?.phase} status=${run?.status} discovered=${run?.discovered_count} verified=${run?.verified_count} review=${run?.needs_review_count} promoted=${run?.promoted_count} (jobs: crawl=${stats.crawlJobs} analysis=${stats.analysisJobs} failures=${stats.failures})`,
    );
    if (run && ["completed", "partially_completed", "failed", "cancelled"].includes(run.status) && stats.stoppedReason === "empty") break;
    if (stats.stoppedReason === "empty" && stats.discoverySteps === 0) break;
  }

  const run = await getDiscoveryRun(db, runId);
  const counts = await countCandidatesByStatus(db, runId);
  console.log("\n=== Discovery Run 結果 ===");
  console.log(`status: ${run?.status} / phase: ${run?.phase}`);
  console.log(`候補: ${JSON.stringify(counts)}`);
  console.log(`昇格: ${run?.promoted_count}社`);
  console.log(`Provider統計: ${JSON.stringify(run?.provider_stats)}`);

  const verified = await listCandidatesByRun(db, runId, "verified", 20);
  console.log("\n--- verified（営業候補へ昇格） ---");
  for (const c of verified) console.log(`  ${c.verification_score}点 ${c.name} / ${c.website ?? "(サイトなし)"} / 法人番号=${c.corporate_number ?? "なし"} / 情報源=${c.sources.join("+")}`);

  const review = await listCandidatesByRun(db, runId, "needs_review", 20);
  console.log("\n--- needs_review（人の確認待ち。companies には入れていない） ---");
  for (const c of review) console.log(`  ${c.verification_score}点 ${c.name} / ${c.website ?? "(サイトなし)"} / 理由=${c.reject_reason ?? "-"}`);

  const rejected = await listCandidatesByRun(db, runId, "rejected", 10);
  console.log("\n--- rejected ---");
  for (const c of rejected) console.log(`  ${c.verification_score ?? 0}点 ${c.name} / ${c.reject_reason ?? "-"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
