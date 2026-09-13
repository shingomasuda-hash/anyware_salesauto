/**
 * 営業フォームを開いて、送信直前まで自動で入力する。**送信はしない。**
 *
 *   npm run outreach                     … 対象企業と入力できる項目を表示するだけ
 *   npm run outreach -- --open            … ブラウザを開いて実際に入力する
 *   npm run outreach -- --open --limit 5
 *   npm run outreach -- --open --company <企業ID>
 *
 * 流れ
 *   1. 問い合わせフォームのURLを開く
 *   2. 項目の意味を判定して、差出人情報と取材依頼文を入力する
 *   3. 入力できなかった項目（同意チェック・意味不明な項目）を一覧で表示する
 *   4. 人が内容を確認して送信ボタンを押す
 *   5. ターミナルで結果（送信した / 送らない）を記録する
 *
 * 安全のための制約
 *   - 送信ボタンは押さない。クリックもしない
 *   - 同意チェックは自動で入れない（同意は人が行う行為のため）
 *   - 差出人情報が未設定の項目は埋めない（架空の連絡先を送らない）
 *   - 営業を断っている企業は対象にしない
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import readline from "node:readline/promises";
import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";
import { updateCompany } from "../src/db/repositories/companies";
import { warnIfBehindRemote } from "./lib/git-freshness";
import { getSenderProfile, missingSenderFields, SENDER_FIELD_LABEL } from "../src/lib/outreach/sender";
import { planFormFill, type FormField } from "../src/lib/outreach/form-fill";
import { EXTRACT_FORM_FIELDS } from "../src/lib/outreach/extract-form";
import { getOutreachConfig, outreachLabel } from "../src/lib/config/outreach";

type Row = {
  id: string;
  company_name: string;
  prefecture: string | null;
  website_url: string | null;
  contact_form_url: string | null;
  contact_page_url: string | null;
  outreach_subject: string | null;
  outreach_body: string | null;
  outreach_status: string;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const open = process.argv.includes("--open");
const limit = Math.max(1, Number(arg("limit") ?? 10));
const companyId = arg("company");

async function main() {
  await warnIfBehindRemote();
  const db = getDb();
  const sender = getSenderProfile();
  const outreach = getOutreachConfig();

  const missing = missingSenderFields(sender);
  console.log(`文面の目的: ${outreachLabel(outreach.purpose)}`);
  if (missing.length > 0) {
    console.log(`\n⚠️ 差出人情報が足りません。.env.local に設定してください。`);
    for (const key of missing) console.log(`   ${SENDER_FIELD_LABEL[key]}`);
    console.log(`\n未設定の項目は入力せず空欄のままにします（架空の連絡先を送らないため）。`);
  }

  const rows = await rawRows<Row>(
    db,
    sql`select id, company_name, prefecture, website_url, contact_form_url, contact_page_url,
               outreach_subject, outreach_body, outreach_status
        from company_overview
        where outreach_body is not null
          and contact_form_url is not null
          and sales_contact_allowed <> 'false'
          and outreach_status in ('unsent','failed')
          ${companyId ? sql`and id = ${companyId}` : sql``}
        order by sales_priority_score desc nulls last
        limit ${limit}`,
  );

  if (rows.length === 0) {
    console.log("\n対象の企業がありません。");
    console.log("条件: 取材依頼文が作成済み・問い合わせフォームのURLがある・営業可・未送信");
    return;
  }

  console.log(`\n対象: ${rows.length}社`);
  for (const r of rows) console.log(`  ${r.company_name}（${r.prefecture ?? "—"}）  ${r.contact_form_url}`);

  if (!open) {
    console.log(`\nブラウザを開いて入力するには --open を付けてください（例: npm run outreach -- --open --limit 3）`);
    console.log("送信は行いません。入力後、内容を確認してご自身で送信してください。");
    return;
  }

  // Playwright は --open のときだけ読み込む（未インストールでも表示だけは動くように）
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("\nPlaywright が入っていません。次を実行してください:");
    console.log("  npm install -D playwright && npx playwright install chromium");
    return;
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (const [i, row] of rows.entries()) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[${i + 1}/${rows.length}] ${row.company_name}`);
    console.log("=".repeat(60));
    const page = await context.newPage();
    try {
      await page.goto(row.contact_form_url!, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const fields = (await page.evaluate(EXTRACT_FORM_FIELDS)) as FormField[];

      if (fields.length === 0) {
        console.log("入力できる項目が見つかりませんでした。ページをご確認ください。");
        await updateCompany(db, row.id, { outreach_status: "failed", outreach_status_at: new Date().toISOString(), outreach_note: "フォーム項目を読み取れませんでした" });
        const ans = (await rl.question("次へ進みますか？ [Enter=次へ / q=終了] ")).trim();
        if (ans === "q") break;
        continue;
      }

      const plan = planFormFill(fields, sender, { subject: row.outreach_subject, body: row.outreach_body });

      let filled = 0;
      for (const item of plan.items) {
        if (item.value === null) continue;
        try {
          const locator = page.locator(item.field.selector).first();
          if (item.field.kind === "select") await locator.selectOption(item.value);
          else await locator.fill(item.value);
          // 入力した箇所が分かるように色をつける（確認しやすくするため）
          await locator.evaluate((el: HTMLElement) => {
            el.style.outline = "2px solid #16a34a";
            el.style.backgroundColor = "#f0fdf4";
          });
          filled++;
        } catch {
          item.skipReason = "入力できませんでした（ページの作りが特殊です）";
        }
      }

      console.log(`\n入力した項目: ${filled}件（緑の枠が付いています）`);
      for (const item of plan.items.filter((x) => x.value !== null)) {
        const shown = item.value!.length > 40 ? `${item.value!.slice(0, 40)}…` : item.value!;
        console.log(`  ○ ${item.field.label ?? item.field.name ?? item.field.selector}: ${shown}`);
      }

      const manual = plan.items.filter((x) => x.value === null);
      if (manual.length > 0) {
        console.log(`\n人が入力・確認する項目: ${manual.length}件`);
        for (const item of manual) {
          console.log(`  ● ${item.field.label ?? item.field.name ?? item.field.selector}${item.field.required ? "（必須）" : ""}`);
          console.log(`      ${item.skipReason}`);
        }
      }

      console.log(`\n内容を確認して、ブラウザで送信ボタンを押してください（このスクリプトは送信しません）。`);
      const ans = (await rl.question("結果を記録します [s=送信した / n=送らない / Enter=保留 / q=終了] ")).trim().toLowerCase();

      if (ans === "s") {
        await updateCompany(db, row.id, { outreach_status: "sent", outreach_status_at: new Date().toISOString(), outreach_note: null });
        console.log("送信済みとして記録しました。");
      } else if (ans === "n") {
        const reason = (await rl.question("送らない理由（任意）: ")).trim();
        await updateCompany(db, row.id, { outreach_status: "skipped", outreach_status_at: new Date().toISOString(), outreach_note: reason || "人の判断で送信を見送り" });
        console.log("見送りとして記録しました。");
      } else {
        await updateCompany(db, row.id, { outreach_status: "opened", outreach_status_at: new Date().toISOString(), outreach_note: "入力済み・送信は未確認" });
        console.log("保留として記録しました（次回また対象になります）。");
      }
      if (ans === "q") break;
    } catch (err) {
      console.log(`フォームを開けませんでした: ${err instanceof Error ? err.message : String(err)}`);
      await updateCompany(db, row.id, { outreach_status: "failed", outreach_status_at: new Date().toISOString(), outreach_note: err instanceof Error ? err.message.slice(0, 300) : null });
    } finally {
      await page.close().catch(() => {});
    }
  }

  rl.close();
  await browser.close();
  console.log("\n終了しました。");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
