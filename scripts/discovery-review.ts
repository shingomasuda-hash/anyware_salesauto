/**
 * Review Queue（needs_review の候補）を CLI で確認・承認・却下する。
 *   npm run discovery:review                          … 一覧
 *   npm run discovery:review -- --approve <id>        … 承認して companies へ昇格
 *   npm run discovery:review -- --reject <id> --reason "理由"
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { getDb } from "../src/db";
import { getCandidate, listReviewQueue } from "../src/db/repositories/discovery";
import { approveCandidate, rejectCandidate } from "../src/lib/discovery/review";
import { Logger } from "../src/lib/logging/logger";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const db = getDb();
  const logger = new Logger(db, { category: "company" });
  const approve = arg("approve");
  const reject = arg("reject");

  if (approve) {
    const candidate = await getCandidate(db, approve);
    if (!candidate) throw new Error(`候補が見つかりません: ${approve}`);
    const result = await approveCandidate(db, candidate, { websiteUrl: arg("website") ?? null, reviewedBy: "cli" }, logger);
    console.log(`承認: ${candidate.name} → company ${result.companyId}（${result.created ? "新規" : "既存"}）`);
    return;
  }
  if (reject) {
    const candidate = await getCandidate(db, reject);
    if (!candidate) throw new Error(`候補が見つかりません: ${reject}`);
    await rejectCandidate(db, candidate, arg("reason") ?? "手動で却下", "cli");
    console.log(`却下: ${candidate.name}`);
    return;
  }

  const rows = await listReviewQueue(db, 100);
  console.log(`Review Queue: ${rows.length}件\n`);
  for (const r of rows) {
    console.log(`${r.id}`);
    console.log(`  ${r.name}（${r.verification_score ?? 0}点）${r.prefecture ?? ""}${r.city ?? ""}`);
    console.log(`  サイト: ${r.website ?? "なし"} / 法人番号: ${r.corporate_number ?? "なし"} / 情報源: ${r.sources.join("+")}`);
    console.log(`  理由: ${r.reject_reason ?? "-"}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
