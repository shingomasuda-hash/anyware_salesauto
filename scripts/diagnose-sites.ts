/**
 * 「公式サイトを特定できなかった」原因を実データから切り分ける。
 *
 *   npm run db:diagnose-sites              … 記録済みデータから内訳を出す（通信なし）
 *   npm run db:diagnose-sites -- --refetch 20 … 20社を取り直して仮説を検証する
 *
 * 確認待ち244件が全件「公式サイトを断定できず」だったが、
 * 検索で見つからなかったのか、見つかったが照合で落ちたのかが分からないと
 * 直す場所を間違える。まず数字で切り分ける。
 *
 * --refetch は「トップページだけでは所在地・電話が載っていないから点が足りない」
 * という仮説を検証する。会社概要ページまで読めば点が入るかを実測する。
 * Web検索APIは使わないため費用はかからない。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { sql } from "drizzle-orm";
import { getDb, rawRows } from "../src/db";
import { addressAppearsIn, normalizePhone } from "../src/lib/companies/normalize";
import { rejectOfficialSiteUrl } from "../src/lib/companies/official-site";
import { extractHtml } from "../src/lib/crawler/extract";
import { fetchHtml } from "../src/lib/integrations/http/fetch";

type Row = {
  id: string;
  name: string;
  prefecture: string | null;
  address: string | null;
  phone: string | null;
  corporate_number: string | null;
  website: string | null;
  primary_source: string;
  sources: string[];
  verification_score: number | null;
  official_site_confidence: number | null;
  verification_signals: unknown;
  raw_data: unknown;
  status: string;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const refetch = Number(arg("refetch") ?? 0);

function tally<T extends string>(items: T[]): [T, number][] {
  const map = new Map<T, number>();
  for (const i of items) map.set(i, (map.get(i) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function show(title: string, rows: [string, number][], total: number) {
  console.log(`\n${title}`);
  for (const [label, count] of rows) {
    const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
    console.log(`  ${String(count).padStart(4)}件 (${pct.padStart(5)}%)  ${label}`);
  }
}

async function main() {
  const db = getDb();
  const rows = await rawRows<Row>(
    db,
    sql`select id, name, prefecture, address, phone, corporate_number, website,
               primary_source, sources, verification_score, official_site_confidence,
               verification_signals, raw_data, status
        from discovery_candidates
        where company_id is null
          and status in ('needs_review', 'rejected')
        order by created_at desc`,
  );

  if (rows.length === 0) {
    console.log("対象の候補がありません。");
    return;
  }

  console.log(`=== 公式サイトを特定できなかった候補の内訳 ===`);
  console.log(`対象: ${rows.length}件`);

  // 記録された却下理由（website が null でも、検索では見つかっていた場合がある）
  const reasons = rows.map((r) => {
    const raw = (r.raw_data ?? {}) as { officialSite?: { reasons?: string[] } };
    const first = raw.officialSite?.reasons?.[0] ?? "";
    if (/検索で見つけたサイトは会社情報と十分に一致しませんでした/.test(first)) return "検索で候補は見つかったが、照合が足りず破棄した";
    if (/公式サイト候補が見つかりません/.test(first)) return "候補URLが1件も見つからなかった";
    if (/公式サイト候補を取得できませんでした/.test(first)) return "候補URLは見つかったがアクセスできなかった";
    return first ? `その他: ${first.slice(0, 60)}` : "記録なし";
  });
  show("■ 公式サイト判定が記録した結果", tally(reasons), rows.length);

  // 1段目: 候補URLがあるか
  const noUrl = rows.filter((r) => !r.website);
  const withUrl = rows.filter((r) => r.website);
  show("■ 候補URLの有無", [
    [`候補URLが1件も見つからなかった（検索の問題）`, noUrl.length],
    [`候補URLはあった（照合の問題）`, withUrl.length],
  ], rows.length);

  // 2段目: URLがあるものは除外ルールか照合か
  const blocked = withUrl.filter((r) => rejectOfficialSiteUrl(r.website));
  const scored = withUrl.filter((r) => !rejectOfficialSiteUrl(r.website));
  if (withUrl.length > 0) {
    show("■ 候補URLがあったもの", [
      ["除外ルールで落ちた（そもそも公式サイトになり得ないURL）", blocked.length],
      ["除外ルールは通ったが信頼度が足りない", scored.length],
    ], withUrl.length);
  }

  if (blocked.length > 0) {
    show("■ 除外ルールの内訳", tally(blocked.map((r) => rejectOfficialSiteUrl(r.website) ?? "")), blocked.length);
  }

  // 3段目: 信頼度が足りないものは、どの加点が取れていたか
  if (scored.length > 0) {
    show("■ 信頼度の分布（60点で公式サイトと確定）", tally(scored.map((r) => {
      const c = r.official_site_confidence ?? 0;
      if (c === 0) return "0点（ページを読めていない）";
      if (c < 20) return "1-19点";
      if (c < 40) return "20-39点";
      if (c < 60) return "40-59点（あと少し）";
      return "60点以上";
    })), scored.length);

    // 公式サイト判定で実際に取れた加点理由（クロール時に記録済み）
    const reasons: string[] = [];
    for (const r of scored) {
      const raw = (r.raw_data ?? {}) as { officialSite?: { reasons?: string[] } };
      for (const reason of raw.officialSite?.reasons ?? []) reasons.push(reason);
    }
    if (reasons.length > 0) {
      show("■ 取れていた加点（この候補群で何が一致したか）", tally(reasons), scored.length);
    }

    // 照合に使える材料がそもそも手元にあるか
    show("■ 照合に使える材料の保有率", [
      ["所在地あり", scored.filter((r) => r.address).length],
      ["電話番号あり", scored.filter((r) => r.phone).length],
      ["法人番号あり", scored.filter((r) => r.corporate_number).length],
    ], scored.length);
  }

  // 4段目: 仮説の検証。トップページだけでは足りないのではないか
  // website が null でも、観測に候補URLが残っていれば検証に使える
  const withObservedUrl = noUrl
    .map((r) => {
      const raw = (r.raw_data ?? {}) as { observations?: { website?: string | null }[] };
      const url = (raw.observations ?? []).map((o) => o.website).find((u) => u && !rejectOfficialSiteUrl(u));
      return url ? ({ ...r, website: url } satisfies Row) : null;
    })
    .filter((r) => r !== null);
  if (withObservedUrl.length > 0) {
    console.log(`\n※ 候補URLが null の ${noUrl.length}件のうち ${withObservedUrl.length}件は、情報源が示したURLが記録に残っています（検証に使えます）。`);
  }

  if (refetch > 0) {
    const pool = [...scored, ...withObservedUrl];
    const sample = pool.filter((r) => r.address || r.phone).slice(0, refetch);
    console.log(`\n=== 仮説の検証: 会社概要ページまで読めば点が入るか（${sample.length}社） ===`);
    console.log("トップページには所在地・電話を載せず、会社概要ページに載せるサイトが多い。");
    console.log("その場合トップページだけを読む現在の実装では所在地15点・電話15点が取れない。\n");

    let topOnly = 0;
    let recoveredByAbout = 0;
    let notFound = 0;
    let unreachable = 0;

    for (const r of sample) {
      const url = r.website!;
      const top = await fetchHtml(url);
      if (!top.ok || !top.body) {
        unreachable++;
        console.log(`  × ${r.name}: 読めない（${top.status ?? top.error}）`);
        continue;
      }
      const topText = extractHtml(top.body, top.finalUrl, 20_000).text;
      const topHasAddress = r.address ? addressAppearsIn(r.address, topText) : false;
      const phoneDigits = normalizePhone(r.phone)?.replace(/\D/g, "") ?? "";
      const topHasPhone = phoneDigits ? topText.replace(/[^\d]/g, "").includes(phoneDigits) : false;

      if (topHasAddress || topHasPhone) {
        topOnly++;
        console.log(`  ○ ${r.name}: トップページで一致（住所 ${topHasAddress ? "○" : "×"} / 電話 ${topHasPhone ? "○" : "×"}）`);
        continue;
      }

      // 会社概要らしいリンクを1つ辿る
      const links = extractHtml(top.body, top.finalUrl, 20_000).links;
      const aboutUrl = links.find((l) => /company|about|corporate|outline|profile|gaiyou|kaisha/i.test(l.url))?.url;
      if (!aboutUrl) {
        notFound++;
        console.log(`  △ ${r.name}: 会社概要ページへのリンクが無い`);
        continue;
      }
      const about = await fetchHtml(aboutUrl);
      if (!about.ok || !about.body) {
        notFound++;
        console.log(`  △ ${r.name}: 会社概要ページを読めない（${aboutUrl}）`);
        continue;
      }
      const aboutText = extractHtml(about.body, about.finalUrl, 20_000).text;
      const aboutHasAddress = r.address ? addressAppearsIn(r.address, aboutText) : false;
      const aboutHasPhone = phoneDigits ? aboutText.replace(/[^\d]/g, "").includes(phoneDigits) : false;
      if (aboutHasAddress || aboutHasPhone) {
        recoveredByAbout++;
        console.log(`  ◎ ${r.name}: 会社概要ページで一致（住所 ${aboutHasAddress ? "○" : "×"} / 電話 ${aboutHasPhone ? "○" : "×"}）`);
      } else {
        notFound++;
        console.log(`  △ ${r.name}: 会社概要ページにも一致なし（別会社のサイトの可能性）`);
      }
    }

    console.log(`\n--- 検証結果 ---`);
    console.log(`  トップページで一致した:           ${topOnly}社`);
    console.log(`  会社概要ページまで読めば一致した: ${recoveredByAbout}社  ← ここが多ければ実装を直せば取り戻せる`);
    console.log(`  どちらにも一致しなかった:         ${notFound}社  ← 別会社のサイトを見ている可能性`);
    console.log(`  読めなかった:                     ${unreachable}社`);
    if (sample.length > 0) {
      const gain = ((recoveredByAbout / sample.length) * 100).toFixed(1);
      console.log(`\n  会社概要ページを読むことで取り戻せる見込み: ${gain}%`);
    }
  } else if (scored.length + withObservedUrl.length > 0) {
    console.log(`\n仮説を検証するには: npm run db:diagnose-sites -- --refetch 20`);
    console.log("（該当サイトを取り直すだけで、Web検索APIは使いません）");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
