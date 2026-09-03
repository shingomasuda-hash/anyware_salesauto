/**
 * 開発用シード。
 * 1) ログインユーザー作成（SEED_USER_EMAIL / SEED_USER_PASSWORD、既定: admin@example.com / password123）
 * 2) --with-mock-search: モックモードで「大阪府 / 製造業 / 20社」の検索ジョブを作成し、完了まで処理
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { createSearchJob } from "../src/lib/jobs/enqueue";
import { processJobs } from "../src/lib/jobs/runner";
import { getDataMode } from "../src/lib/config/env";

async function main() {
  const db = createSupabaseAdminClient();
  const email = process.env.SEED_USER_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_USER_PASSWORD ?? "password123";

  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  if (users?.users.some((u) => u.email === email)) {
    console.log(`[seed] user exists: ${email}`);
  } else {
    const { error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    console.log(`[seed] created user: ${email} / ${password}`);
  }

  if (process.argv.includes("--with-mock-search")) {
    if (getDataMode() !== "mock") {
      console.log("[seed] DATA_MODE=mock ではないため検索シードはスキップします");
      return;
    }
    const jobId = await createSearchJob(db, { prefecture: "大阪府", industry: "manufacturing", employeeMin: 20, employeeMax: 300, requestedCount: 20 }, { name: "大阪府 / 製造業 / 20社 (seed)", provider: "mock" });
    console.log(`[seed] search job created: ${jobId}`);
    for (let i = 0; i < 30; i++) {
      const stats = await processJobs({ db, maxRuntimeMs: 55_000 });
      console.log(`[seed] pass ${i + 1}: search=${stats.searchSteps} crawl=${stats.crawlJobs} analysis=${stats.analysisJobs} failures=${stats.failures}`);
      if (stats.stoppedReason === "empty") break;
    }
    console.log("[seed] done");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
