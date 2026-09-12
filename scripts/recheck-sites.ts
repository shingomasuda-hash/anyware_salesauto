/**
 * 登録済みの公式サイトURLを、現在の判定基準で再点検する。
 *
 *   npm run db:recheck-sites              … 対象を表示するだけ
 *   npm run db:recheck-sites -- --apply   … 不適切なURLを外して要確認に戻す
 *   npm run db:recheck-sites -- --no-fetch … トップページを見ずURLの形だけで判定（速い）
 *
 * 公式サイトの判定は実データ検証で何度も厳しくしてきたが、
 * 既に登録済みの URL には遡って適用されていなかった。
 * そのため法人情報DB・電話番号検索・団体の名簿ページが「公式サイト」として残り、
 * 再クロールでもそこを読み続けてしまっていた。
 *
 * URL は website_candidates に理由つきで残すので、後から確認できる。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";
import { updateCompany } from "../src/db/repositories/companies";
import { recheckSiteUrl } from "../src/lib/companies/site-recheck";
import { enqueueCrawlJob } from "../src/lib/jobs/enqueue";
import { extractDomain } from "../src/lib/companies/normalize";
import { checkDomainOwnership, domainRootUrl } from "../src/lib/companies/official-site";
import { extractHtml } from "../src/lib/crawler/extract";
import { fetchHtml } from "../src/lib/integrations/http/fetch";
import type { Json } from "../src/db/types";

type Row = { id: string; company_name: string; website_url: string; website_candidates: unknown };
type RestoreRow = { id: string; company_name: string; prefecture: string | null; website_candidates: unknown };
type StoredCandidate = { url?: string; source?: string; rejectedReason?: string };

const apply = process.argv.includes("--apply");
/** トップページを取得して持ち主を確認する処理を省く */
const noFetch = process.argv.includes("--no-fetch");

/**
 * ドメインのトップページを見て、本当にその企業のサイトかを確認する。
 * 商工会議所の会員紹介ページ・地域ポータルの企業ページは、社名も住所も電話も
 * 載っているためページ単体では区別できない。トップページの持ち主を見れば分かる。
 */
async function checkOwnership(companyName: string, url: string) {
  const root = domainRootUrl(url);
  if (!root) return { owned: true, reason: "トップページURLを組み立てられず保留" };
  let rootTitle: string | null = null;
  let rootText: string | null = null;
  try {
    const res = await fetchHtml(root);
    if (res.ok && res.body) {
      const extracted = extractHtml(res.body, res.finalUrl, 6000);
      rootTitle = extracted.title;
      rootText = extracted.text;
    }
  } catch {
    // 取得できなければ判断を保留する（取得失敗で実在する公式サイトを捨てないため）
  }
  return checkDomainOwnership({ companyName, url, rootTitle, rootText });
}

async function main() {
  const db = getDb();
  const rows = await rawRows<Row>(
    db,
    sql`select id, company_name, website_url, website_candidates
        from companies
        where website_url is not null
        order by updated_at desc`,
  );

  console.log(`公式サイトが登録されている企業: ${rows.length}社`);

  // 1段目: URL の形で落とせるもの（取得不要）
  const bad = rows
    .map((r) => ({ row: r, verdict: recheckSiteUrl(r.website_url) }))
    .filter((x) => !x.verdict.ok);

  // 2段目: URL の形は問題ないが、ドメインの持ち主が別のもの
  if (!noFetch) {
    const remaining = rows.filter((r) => recheckSiteUrl(r.website_url).ok);
    console.log(`うち ${remaining.length}社のトップページを確認します（API費用はかかりません）…`);
    let checked = 0;
    for (const r of remaining) {
      const ownership = await checkOwnership(r.company_name, r.website_url);
      checked++;
      if (checked % 20 === 0) console.log(`  ${checked}/${remaining.length}社`);
      if (!ownership.owned) bad.push({ row: r, verdict: { ok: false, reason: ownership.reason } });
    }
  }

  if (bad.length === 0) {
    console.log("現在の基準で不適切なURLはありません。");
    await restoreRejected(db);
    return;
  }

  console.log(`\n公式サイトとして不適切: ${bad.length}社\n`);
  for (const { row, verdict } of bad.slice(0, 40)) {
    console.log(`  ${row.company_name}`);
    console.log(`    ${row.website_url}`);
    console.log(`    → ${verdict.reason}`);
  }
  if (bad.length > 40) console.log(`  … 他 ${bad.length - 40}社`);

  if (!apply) {
    console.log(`\n外すには --apply を付けてください（例: npm run db:recheck-sites -- --apply）`);
    console.log("外した企業は「公式HP要確認」になり、一覧から除外されます。URL は履歴に残します。");
    await restoreRejected(db);
    return;
  }

  for (const { row, verdict } of bad) {
    const previous = Array.isArray(row.website_candidates) ? (row.website_candidates as unknown[]) : [];
    await updateCompany(db, row.id, {
      website_url: null,
      website_domain: null,
      // 外した理由を残す（消さずに履歴として持つ）
      website_candidates: [...previous, { url: row.website_url, source: "search", rejectedReason: verdict.reason }] as unknown as Json,
      verification_status: "needs_review",
      crawl_status: "no_website",
      official_site_confidence: null,
      // その企業のサイトではないページから拾った情報なので、連絡先として残してはいけない。
      // 商工会議所の会員紹介ページのメールアドレス・電話番号を企業の連絡先にしてしまう。
      email: null,
      phone: null,
      contact_page_url: null,
      contact_form_url: null,
      recruit_page_url: null,
      recruit_target: null,
      recruit_target_reasons: null,
      job_boards: null,
      instagram_url: null,
      facebook_url: null,
      x_url: null,
      youtube_url: null,
      linkedin_url: null,
      tiktok_url: null,
      // 営業拒否の記載は消さない（安全側に倒す）
    });
  }
  console.log(`\n${bad.length}社の公式サイトを外し、「要確認」に戻しました。`);
  console.log("そのページから拾っていた連絡先・採用ページ・SNSも消しました（別サイトの情報だったため）。");
  console.log("これらの企業は一覧から除外されます（フィルタ「公式HP未確認も表示」で確認できます）。");

  await restoreRejected(db);
}

/**
 * 過去に外した URL を、現在の基準で再評価して戻す。
 *
 * 判定を直すたびに「前の基準で外した企業」が取り残されるため、
 * 外す処理と同じスクリプトで戻せるようにする。
 * 実際に、名簿ページの判定が厳しすぎて自社ドメインを3社外してしまった。
 *
 * 戻すのは website_url とクロール待ちの状態までで、「確認済み」にはしない。
 * 公式サイトの確定はクロールの判定に任せる（検証を飛ばさない）。
 */
async function restoreRejected(db: ReturnType<typeof getDb>) {
  const rows = await rawRows<RestoreRow>(
    db,
    sql`select id, company_name, prefecture, website_candidates
        from companies
        where website_url is null
          and website_candidates is not null
        order by updated_at desc`,
  );

  const restorable: { row: RestoreRow; url: string }[] = [];
  for (const row of rows) {
    const candidates = Array.isArray(row.website_candidates) ? (row.website_candidates as StoredCandidate[]) : [];
    const rejected = candidates.filter((c) => c && c.url && c.rejectedReason);
    for (const c of rejected) {
      if (!c.url || !recheckSiteUrl(c.url).ok) continue;
      const ownership = await checkOwnership(row.company_name, c.url);
      if (!ownership.owned) continue;
      restorable.push({ row, url: c.url });
      break;
    }
  }

  if (restorable.length === 0) return;

  console.log(`\n■ 現在の基準では問題ない URL（過去に外したもの）: ${restorable.length}社`);
  for (const { row, url } of restorable.slice(0, 20)) {
    console.log(`  ${row.company_name}（${row.prefecture ?? "—"}）`);
    console.log(`    ${url}`);
  }
  if (restorable.length > 20) console.log(`  … 他 ${restorable.length - 20}社`);

  if (!apply) {
    console.log("  → --apply を付けると公式サイトに戻し、クロールし直します。");
    return;
  }

  let restored = 0;
  for (const { row, url } of restorable) {
    const candidates = Array.isArray(row.website_candidates) ? (row.website_candidates as StoredCandidate[]) : [];
    await updateCompany(db, row.id, {
      website_url: url,
      website_domain: extractDomain(url),
      // 外した印を消す（次の点検でまた戻す対象にならないように）
      website_candidates: candidates.map((c) => (c.url === url ? { url: c.url, source: c.source ?? "search" } : c)) as unknown as Json,
      crawl_status: "not_crawled",
      official_site_confidence: null,
    });
    await enqueueCrawlJob(db, row.id, { enqueueAnalysis: false });
    restored++;
  }
  console.log(`\n${restored}社の公式サイトを戻し、クロールし直します（確定はクロールの判定に任せます）。`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
