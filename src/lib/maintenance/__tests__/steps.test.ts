import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MAINTENANCE_STEPS } from "../steps";
import { IS_ANALYZABLE, IS_RECRAWLABLE } from "../targets";

const index = (script: string) => MAINTENANCE_STEPS.findIndex((s) => s.script === script);

describe("保守処理の順番", () => {
  it("公式サイトの再点検は再クロールより前に実行する", () => {
    // 逆にすると、公式サイトでないURLを20ページずつ読みに行ってしまう
    expect(index("recheck-sites.ts")).toBeGreaterThanOrEqual(0);
    expect(index("recheck-sites.ts")).toBeLessThan(index("recrawl.ts"));
  });

  it("スキーマ確認が最初で、失敗したら止まる", () => {
    expect(MAINTENANCE_STEPS[0].script).toBe("check-schema.ts");
    expect(MAINTENANCE_STEPS[0].required).toBe(true);
  });

  it("キューの処理は最後で、--apply のときだけ動く", () => {
    const last = MAINTENANCE_STEPS[MAINTENANCE_STEPS.length - 1];
    expect(last.script).toBe("run-jobs.ts");
    expect(last.applyOnly).toBe(true);
  });

  it("確認だけのとき DB を変更する引数を渡さない", () => {
    for (const step of MAINTENANCE_STEPS) {
      expect(step.args).not.toContain("--apply");
    }
  });

  it("参照しているスクリプトがすべて存在する", () => {
    for (const step of MAINTENANCE_STEPS) {
      expect(fs.existsSync(path.join(process.cwd(), "scripts", step.script))).toBe(true);
    }
  });
});

describe("対象条件の共有", () => {
  it("採用ページの有無で対象を絞らない", () => {
    // 採用ページを持たない企業は主要ターゲット（公式に採用ページが無い＝提案余地がある）
    expect(IS_ANALYZABLE).not.toContain("has_recruit_page");
    expect(IS_RECRAWLABLE).not.toContain("has_recruit_page");
  });

  it("AI分析の対象はクロール済み・営業可・公式サイト確認済みに限る", () => {
    expect(IS_ANALYZABLE).toContain("crawl_status = 'crawled'");
    expect(IS_ANALYZABLE).toContain("sales_contact_allowed <> 'false'");
    expect(IS_ANALYZABLE).toContain("verification_status in ('verified','manual')");
  });

  it("スクリプトは条件を書き写さず共有定数を使う", () => {
    for (const file of ["scripts/recrawl.ts", "scripts/reanalyze.ts"]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).toContain("maintenance/targets");
    }
  });
});

describe("確認待ちの自動判定", () => {
  it("昇格でcompaniesが増えるため、URL再点検より前に実行する", () => {
    expect(index("auto-review.ts")).toBeGreaterThanOrEqual(0);
    expect(index("auto-review.ts")).toBeLessThan(index("recheck-sites.ts"));
  });
});
