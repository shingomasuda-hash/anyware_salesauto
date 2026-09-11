/**
 * 営業ターゲットとしての採用状況の区分。
 *
 * 狙うのは「採用で困っていそう」「採用に力を入れていそう」
 * 「採用はしていそうだが公式サイトに採用ページが無い」の3つ。
 * とくに3つ目は、採用ページの有無で絞ると取りこぼす主要ターゲット。
 */
import { describe, expect, it } from "vitest";
import { classifyRecruitTarget, type RecruitTargetInput } from "../recruit-target";

function input(partial: Partial<RecruitTargetInput> = {}): RecruitTargetInput {
  return {
    hasRecruitPage: false,
    recruitPageCount: 0,
    hasJobListing: false,
    hasEmployeePage: false,
    hasMessagePage: false,
    recruitTextLength: 0,
    jobBoards: [],
    recruitMentioned: false,
    crawledEnough: true,
    ...partial,
  };
}

describe("採用ページが無い企業", () => {
  it("求人媒体を使っていれば主要ターゲットにする", () => {
    const r = classifyRecruitTarget(input({ jobBoards: ["Indeed"] }));
    expect(r.target).toBe("no_recruit_page");
    expect(r.reasons.join()).toContain("Indeed");
  });

  it("本文に採用の記載があれば主要ターゲットにする", () => {
    expect(classifyRecruitTarget(input({ recruitMentioned: true })).target).toBe("no_recruit_page");
  });

  it("採用の記載がまったく無ければ対象外", () => {
    expect(classifyRecruitTarget(input()).target).toBe("no_signal");
  });

  it("サイトを読めていない場合は対象外にする（推測で判断しない）", () => {
    const r = classifyRecruitTarget(input({ crawledEnough: false }));
    expect(r.target).toBe("no_signal");
    expect(r.reasons.join()).toContain("十分に読めていない");
  });
});

describe("採用ページがある企業", () => {
  const withPage = { hasRecruitPage: true, recruitPageCount: 1, recruitMentioned: true };

  it("募集要項も社員紹介も無ければ手薄と判定する", () => {
    const r = classifyRecruitTarget(input({ ...withPage, recruitTextLength: 300 }));
    expect(r.target).toBe("weak_recruit_page");
    expect(r.reasons.join()).toContain("いずれも見つからない");
  });

  it("情報量が少なければ手薄と判定する", () => {
    const r = classifyRecruitTarget(input({ ...withPage, hasJobListing: true, hasEmployeePage: true, recruitTextLength: 400 }));
    expect(r.target).toBe("weak_recruit_page");
    expect(r.reasons.join()).toContain("情報量が少ない");
  });

  it("募集要項・社員紹介がそろい情報量もあれば注力と判定する", () => {
    const r = classifyRecruitTarget(
      input({ ...withPage, recruitPageCount: 3, hasJobListing: true, hasEmployeePage: true, recruitTextLength: 3000 }),
    );
    expect(r.target).toBe("active_recruit");
  });

  it("掲載内容が1種類だけなら注力とはみなさない", () => {
    const r = classifyRecruitTarget(input({ ...withPage, hasJobListing: true, recruitTextLength: 5000 }));
    expect(r.target).toBe("weak_recruit_page");
  });
});

describe("判断根拠", () => {
  it("必ず根拠を返す（人が検算できるようにする）", () => {
    for (const i of [input(), input({ jobBoards: ["Indeed"] }), input({ hasRecruitPage: true, recruitPageCount: 1 })]) {
      expect(classifyRecruitTarget(i).reasons.length).toBeGreaterThan(0);
    }
  });

  it("検出した求人媒体を返す", () => {
    expect(classifyRecruitTarget(input({ jobBoards: ["Indeed", "マイナビ"] })).jobBoards).toEqual(["Indeed", "マイナビ"]);
  });
});
