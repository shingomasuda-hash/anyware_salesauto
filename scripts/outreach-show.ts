/**
 * 生成済みの取材依頼文をターミナルに表示する（確認用・DBは変更しない）。
 *
 *   npm run outreach:show             … 直近の3社を表示
 *   npm run outreach:show -- --limit 10
 *   npm run outreach:show -- --company <企業ID>
 *
 * フォームに入力する前に、実際に送られる文面を人が読めるようにする。
 * 文面の調整はプロンプト（src/lib/ai/prompts.ts）と .env.local の
 * SALES_INTERVIEW_* で行い、npm run reanalyze で作り直す。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";
import { getOutreachConfig, outreachLabel } from "../src/lib/config/outreach";
import { getSenderProfile, missingSenderFields, SENDER_FIELD_LABEL } from "../src/lib/outreach/sender";
import { checkContactForm } from "../src/lib/outreach/target";

type Row = {
  id: string;
  company_name: string;
  prefecture: string | null;
  website_url: string | null;
  verification_status: string | null;
  contact_form_url: string | null;
  recruit_target: string | null;
  sales_priority_rank: string | null;
  confidence_score: number | null;
  outreach_subject: string | null;
  outreach_body: string | null;
  outreach_personalization: unknown;
  outreach_hypothesis_note: string | null;
  outreach_status: string;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const limit = Math.max(1, Number(arg("limit") ?? 3));
const companyId = arg("company");

const RECRUIT_LABEL: Record<string, string> = {
  no_recruit_page: "採用ページなし（主要ターゲット）",
  weak_recruit_page: "採用ページが弱い",
  active_recruit: "積極採用",
  no_signal: "採用の痕跡なし",
};

async function main() {
  const db = getDb();
  const outreach = getOutreachConfig();
  const sender = getSenderProfile();

  console.log(`=== ${outreachLabel(outreach.purpose)}の確認 ===`);
  console.log(`取材テーマ: ${outreach.interviewTopic ?? "（未設定）"}`);
  if (outreach.interviewMedium) console.log(`掲載先:     ${outreach.interviewMedium}`);
  if (outreach.interviewFormat) console.log(`形式:       ${outreach.interviewFormat}`);
  console.log(`差出人:     ${[sender.company, sender.name].filter(Boolean).join(" ") || "（未設定）"}`);

  const rows = await rawRows<Row>(
    db,
    sql`select c.id, c.company_name, c.prefecture, c.website_url, c.verification_status, c.contact_form_url,
               c.recruit_target, c.outreach_status,
               a.sales_priority_rank, a.confidence_score,
               a.outreach_subject, a.outreach_body, a.outreach_personalization, a.outreach_hypothesis_note
        from companies c
        join company_analysis a on a.id = c.latest_analysis_id
        where a.outreach_body is not null
          ${companyId ? sql`and c.id = ${companyId}` : sql``}
        order by a.analyzed_at desc
        limit ${limit}`,
  );

  if (rows.length === 0) {
    console.log("\n文面が作成済みの企業がありません。");
    console.log("作るには: npm run reanalyze -- --limit 3 --apply → npm run jobs:run -- --drain");
    return;
  }

  for (const [i, r] of rows.entries()) {
    console.log(`\n${"=".repeat(66)}`);
    console.log(`[${i + 1}/${rows.length}] ${r.company_name}（${r.prefecture ?? "—"}）`);
    console.log("=".repeat(66));
    console.log(`公式サイト: ${r.website_url ?? "—"}`);
    const form = checkContactForm({ websiteUrl: r.website_url, verificationStatus: r.verification_status, contactFormUrl: r.contact_form_url });
    console.log(`問い合わせフォーム: ${r.contact_form_url ?? "（未検出）"}`);
    console.log(`  ${form.ok ? "→ 自動入力の対象です" : `→ 対象外: ${form.reason}`}`);
    console.log(`採用状況: ${RECRUIT_LABEL[r.recruit_target ?? ""] ?? "—"}　営業ランク: ${r.sales_priority_rank ?? "—"}　確度: ${r.confidence_score ?? "—"}`);
    console.log(`送信状態: ${r.outreach_status}`);

    console.log(`\n--- 件名（${(r.outreach_subject ?? "").length}字）---`);
    console.log(r.outreach_subject ?? "（なし）");

    console.log(`\n--- 本文（${(r.outreach_body ?? "").length}字）---`);
    console.log(r.outreach_body ?? "（なし）");

    const facts = Array.isArray(r.outreach_personalization) ? (r.outreach_personalization as string[]) : [];
    console.log(`\n--- この企業固有として触れた事実（${facts.length}件）---`);
    if (facts.length === 0) console.log("（なし。テンプレート文面の可能性があるため要確認）");
    for (const f of facts) console.log(`  ・${f}`);

    if (r.outreach_hypothesis_note) {
      console.log(`\n--- 推測が含まれる箇所 ---`);
      console.log(r.outreach_hypothesis_note);
    }
  }

  const missing = missingSenderFields(sender);
  if (missing.length > 0) {
    console.log(`\n${"-".repeat(66)}`);
    console.log("差出人情報が足りません（フォーム入力時に空欄になります）:");
    for (const key of missing) console.log(`  ${SENDER_FIELD_LABEL[key]}`);
  }

  console.log(`\n${"-".repeat(66)}`);
  console.log("文面を変えたいとき:");
  console.log("  トーン・構成・長さ  → src/lib/ai/prompts.ts の取材依頼の指示");
  console.log("  取材テーマ・掲載先  → .env.local の SALES_INTERVIEW_TOPIC / MEDIUM / FORMAT");
  console.log("  変更後に作り直す    → npm run reanalyze -- --limit 3 --apply && npm run jobs:run -- --drain");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
