/**
 * 実際の PostgreSQL に対して、生SQL・ビュー・マイグレーションを通す統合テスト。
 *
 * これまでのバグ（ビューの列を途中に挿入してマイグレーションが黙って失敗、
 * 行コンストラクタ IN でパラメータ型が決まらず昇格が失敗、採用ページ前提の
 * 絞り込みが残っていた）は、どれも lint / typecheck / 単体テストを通過していた。
 * 原因は「生SQLが一度も実行されないまま push されていた」こと。
 * ここで実 DB に当てて塞ぐ。
 *
 * 実行方法:
 *   TEST_DATABASE_URL=postgres://... npm run test:db
 * 未設定なら skip する（CI や他の開発者の環境を壊さない）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Db } from "@/db";
import { buildCompanyWhere, companyFilterSchema } from "@/lib/companies/filters";
import { listCompanyOverview } from "@/db/repositories/companies";
import { replaceCompanySources, listCompanySources, refreshDiscoveryRunCounts, insertDiscoveryRun, insertCandidates } from "@/db/repositories/discovery";
import { getMonthlySpend } from "@/lib/ai/pricing";
import { checkRequiredSchema } from "@/db/required-columns";
import { recheckSiteUrl } from "@/lib/companies/site-recheck";

const url = process.env.TEST_DATABASE_URL;
const run = url ? describe : describe.skip;

let pool: Pool;
let db: Db;

run("実DBに対する統合テスト", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema }) as unknown as Db;
    // マイグレーションが実際に通ることをここで検証する
    await migrate(drizzle(pool) as never, { migrationsFolder: "drizzle" });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  describe("マイグレーション", () => {
    it("コードが参照する列と関数がすべて存在する", async () => {
      // db:verify と /api/health が使うのと同じ判定を通す
      const result = await checkRequiredSchema(db);
      expect(result.missingColumns).toEqual({});
      expect(result.missingFunctions).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it("列が欠けていれば検知できる（検知できないチェックは無意味なので確認する）", async () => {
      const broken = await checkRequiredSchema(db, { companies: ["company_name", "存在しない列"] }, ["claim_job", "存在しない関数"]);
      expect(broken.ok).toBe(false);
      expect(broken.missingColumns.companies).toEqual(["存在しない列"]);
      expect(broken.missingFunctions).toEqual(["存在しない関数"]);
    });

    it("テーブルそのものが無い場合も検知できる", async () => {
      const broken = await checkRequiredSchema(db, { 存在しないテーブル: ["a", "b"] }, []);
      expect(broken.ok).toBe(false);
      expect(broken.missingColumns["存在しないテーブル"]).toEqual(["a", "b"]);
    });

    it("ビューに列を途中挿入すると失敗する（この制約でバグが起きた）", async () => {
      await expect(
        pool.query(`create or replace view public.company_overview as select c.id, c.recruit_target from public.companies c`),
      ).rejects.toThrow();
    });
  });

  describe("企業一覧のクエリ", () => {
    it("既定のフィルタが実DBで実行できる", async () => {
      const f = companyFilterSchema.parse({});
      const result = await listCompanyOverview(db, { where: buildCompanyWhere(f), orderBy: [sql`created_at desc`], limit: 10, offset: 0 });
      expect(Array.isArray(result.rows)).toBe(true);
      expect(typeof result.total).toBe("number");
    });

    it("すべてのフィルタ組み合わせが実DBで実行できる", async () => {
      const combos = [
        { includeLowConfidence: "1" },
        { includeRestricted: "1" },
        { includeUnverifiedSite: "1" },
        { includeNoRecruitSignal: "1" },
        { recruitTarget: "no_recruit_page" },
        { recruitTarget: "weak_recruit_page" },
        { hasOutreach: "1" },
        { excludeRestricted: "1" },
        { unanalyzed: "1" },
        { needsReview: "1" },
        { q: "製作所", prefecture: "大阪府", industry: "manufacturing", rank: "A", minPriority: "50" },
      ];
      for (const c of combos) {
        const f = companyFilterSchema.parse(c);
        const result = await listCompanyOverview(db, { where: buildCompanyWhere(f), orderBy: [sql`created_at desc`], limit: 5, offset: 0 });
        expect(Array.isArray(result.rows), JSON.stringify(c)).toBe(true);
      }
    });
  });

  describe("company_sources の書き込み", () => {
    it("同じ観測を何度書いても行が増えない（external_id が null でも）", async () => {
      const { rows } = await pool.query<{ id: string }>(
        `insert into companies (company_name, company_name_normalized, source) values ('統合テスト株式会社','統合テスト','gbiz') returning id`,
      );
      const companyId = rows[0].id;
      const observation = [
        { company_id: companyId, provider: "gbiz" as const, external_id: null, source_url: null, source_type: "discovery" as const, confidence: 90 },
      ];
      for (let i = 0; i < 3; i++) await replaceCompanySources(db, companyId, observation);
      expect(await listCompanySources(db, companyId)).toHaveLength(1);
    });

    it("別の情報源の行は消さない", async () => {
      const { rows } = await pool.query<{ id: string }>(
        `insert into companies (company_name, company_name_normalized, source) values ('統合テスト2株式会社','統合テスト2','gbiz') returning id`,
      );
      const companyId = rows[0].id;
      await replaceCompanySources(db, companyId, [
        { company_id: companyId, provider: "gbiz", external_id: "1234567890123", source_url: null, source_type: "discovery", confidence: 90 },
        { company_id: companyId, provider: "web_search", external_id: "example.jp", source_url: "https://example.jp", source_type: "discovery", confidence: 30 },
      ]);
      await replaceCompanySources(db, companyId, [
        { company_id: companyId, provider: "gbiz", external_id: "1234567890123", source_url: null, source_type: "discovery", confidence: 90 },
      ]);
      const sources = await listCompanySources(db, companyId);
      expect(sources.map((s) => s.provider).sort()).toEqual(["gbiz", "web_search"]);
    });
  });

  describe("探索ランの集計", () => {
    it("実データから件数を引き直せる", async () => {
      const runRow = await insertDiscoveryRun(db, { name: "統合テスト", criteria: {}, mode: "hybrid", requested_count: 5 });
      await insertCandidates(db, [
        { run_id: runRow.id, name: "A社", normalized_name: "a", primary_source: "gbiz", sources: ["gbiz"], source_confidence: 90, status: "verified" },
        { run_id: runRow.id, name: "B社", normalized_name: "b", primary_source: "gbiz", sources: ["gbiz"], source_confidence: 90, status: "needs_review" },
        { run_id: runRow.id, name: "C社", normalized_name: "c", primary_source: "gbiz", sources: ["gbiz"], source_confidence: 90, status: "duplicate" },
      ]);
      const counts = await refreshDiscoveryRunCounts(db, runRow.id);
      expect(counts.total).toBe(3);
      expect(counts.discovered).toBe(2);
      expect(counts.byStatus.duplicate).toBe(1);
    });
  });

  describe("スクリプトの対象抽出", () => {
    // 「採用ページのある企業だけ」「未クロールの企業も対象」といった取り違えを実データで塞ぐ
    beforeAll(async () => {
      await pool.query(`
        insert into companies (company_name, company_name_normalized, source, website_url, website_domain, verification_status, crawl_status, sales_contact_allowed, recruit_target, prefecture)
        values
         ('抽出_採用ページなし','抽出1','gbiz','https://t1.example.jp','t1.example.jp','verified','crawled','true','no_recruit_page','大阪府'),
         ('抽出_営業不可','抽出2','gbiz','https://t2.example.jp','t2.example.jp','verified','crawled','false','weak_recruit_page','大阪府'),
         ('抽出_痕跡なし','抽出3','gbiz','https://t3.example.jp','t3.example.jp','verified','crawled','true','no_signal','大阪府'),
         ('抽出_未クロール','抽出4','gbiz','https://t4.example.jp','t4.example.jp','verified','not_crawled','true','no_recruit_page','大阪府'),
         ('抽出_HP未確認','抽出5','gbiz',null,null,'needs_review','not_crawled','true','no_recruit_page','大阪府')
        on conflict do nothing`);
    });

    /** reanalyze / recrawl と同じ条件を実DBで評価する */
    async function names(where: string): Promise<string[]> {
      const { rows } = await pool.query<{ company_name: string }>(
        `select company_name from company_overview where company_name like '抽出_%' and ${where} order by company_name`,
      );
      return rows.map((r) => r.company_name);
    }

    it("再分析の対象はクロール済み・採用の痕跡あり・営業可だけ", async () => {
      const list = await names(`(recruit_target is null or recruit_target <> 'no_signal')
        and sales_contact_allowed <> 'false'
        and website_url is not null
        and verification_status in ('verified','manual')
        and crawl_status = 'crawled'`);
      // 採用ページが無い企業は主要ターゲットなので必ず含まれる
      expect(list).toContain("抽出_採用ページなし");
      // 営業不可・痕跡なし・未クロール・HP未確認は投入しても意味がない
      expect(list).not.toContain("抽出_営業不可");
      expect(list).not.toContain("抽出_痕跡なし");
      expect(list).not.toContain("抽出_未クロール");
      expect(list).not.toContain("抽出_HP未確認");
    });

    it("再クロールの対象は公式サイトを確認できた企業だけ", async () => {
      const list = await names(`website_url is not null and verification_status in ('verified','manual')`);
      expect(list).toContain("抽出_未クロール");
      expect(list).not.toContain("抽出_HP未確認");
    });
  });

  describe("登録済み公式サイトの再点検", () => {
    // 判定を厳しくしても既存の URL には遡って適用されておらず、
    // 法人情報DB・団体名簿を「公式サイト」として再クロールし続けていた（実データで発生）
    it("実データで登録されていた誤りURLを不適と判定する", () => {
      for (const url of [
        "https://houjin.goo.to/corporations/1120001008038",
        "https://navikyo.com/075-502-5693/",
        "https://tsukulink.net/osaka/city_271225/540773",
        "https://sia-japan.com/company_list/654/",
        "https://www.act-kyoto.jp/organization_list/matsuoka",
      ]) {
        expect(recheckSiteUrl(url).ok, url).toBe(false);
      }
    });

    it("実企業の公式サイトは残す", () => {
      for (const url of ["https://matsushitaseiki.co.jp", "https://sakai-kougyou.co.jp/company/", "https://aoi-group.com/about/"]) {
        expect(recheckSiteUrl(url).ok, url).toBe(true);
      }
    });

    it("不適切なURLの企業は一覧に出ない", async () => {
      await pool.query(`
        insert into companies (company_name, company_name_normalized, source, website_url, website_domain, verification_status, crawl_status, sales_contact_allowed, recruit_target)
        values ('点検_誤りURL','点検誤り','gbiz','https://houjin.goo.to/corporations/1120001008038','houjin.goo.to','needs_review','no_website','true','no_recruit_page')
        on conflict do nothing`);
      const f = companyFilterSchema.parse({});
      const result = await listCompanyOverview(db, { where: buildCompanyWhere(f), orderBy: [sql`created_at desc`], limit: 200, offset: 0 });
      expect(result.rows.map((r) => r.company_name)).not.toContain("点検_誤りURL");
    });
  });

  describe("AI費用の集計", () => {
    it("記録が無くても当月の集計が実行できる", async () => {
      const spend = await getMonthlySpend(db);
      expect(spend.usd).toBeGreaterThanOrEqual(0);
      expect(spend.budgetJpy).toBeGreaterThan(0);
    });

    it("記録があれば費用を算出する", async () => {
      // 既存の記録があっても成り立つよう差分で測る（絶対値で比較すると再実行で壊れる）
      const before = await getMonthlySpend(db);
      await pool.query(
        `insert into ai_usage_logs (purpose, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, success)
         values ('company_analysis','anthropic','claude-opus-5', 1000000, 1000000, 0, 0, true)`,
      );
      const after = await getMonthlySpend(db);
      // 入力 100万トークン $5 + 出力 100万トークン $25
      expect(after.usd - before.usd).toBeCloseTo(30, 1);
    });

    it("失敗した呼び出しは費用に数えない", async () => {
      const before = await getMonthlySpend(db);
      await pool.query(
        `insert into ai_usage_logs (purpose, provider, model, input_tokens, output_tokens, success, error)
         values ('company_analysis','anthropic','claude-opus-5', 1000000, 1000000, false, 'test')`,
      );
      const after = await getMonthlySpend(db);
      expect(after.usd - before.usd).toBeCloseTo(0, 6);
    });
  });
});
