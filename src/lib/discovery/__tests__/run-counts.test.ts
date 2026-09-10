/**
 * 探索ランの集計軸の取り決めを固定する。
 *
 * 「新規候補数（discovered_count）」は重複を除いた件数であり、
 * duplicate は別軸（既に登録済みの企業）として数える。
 * この2軸を足し合わせると保存した候補の総数になる。
 */
import { describe, expect, it } from "vitest";
import type { DiscoveryCandidateStatus } from "@/db/types";

/** UI / CLI / repository が共通で使う計算式 */
function newCandidateCount(counts: Record<DiscoveryCandidateStatus, number>): number {
  return counts.discovered + counts.verifying + counts.verified + counts.needs_review + counts.rejected + counts.failed;
}

function counts(partial: Partial<Record<DiscoveryCandidateStatus, number>>): Record<DiscoveryCandidateStatus, number> {
  return { discovered: 0, verifying: 0, verified: 0, needs_review: 0, duplicate: 0, rejected: 0, failed: 0, ...partial };
}

describe("探索ランの集計軸", () => {
  it("新規候補数に duplicate を含めない", () => {
    const c = counts({ verified: 16, needs_review: 17, rejected: 16, duplicate: 17 });
    expect(newCandidateCount(c)).toBe(49);
  });

  it("新規候補数 + 重複 = 保存した候補の総数", () => {
    const c = counts({ verified: 16, needs_review: 17, rejected: 16, duplicate: 17 });
    const total = Object.values(c).reduce((sum, n) => sum + n, 0);
    expect(newCandidateCount(c) + c.duplicate).toBe(total);
    expect(total).toBe(66);
  });

  it("確認途中の候補も新規候補数に含める（合計が減って見えないようにする）", () => {
    const c = counts({ discovered: 5, verifying: 2, verified: 3, duplicate: 4 });
    expect(newCandidateCount(c)).toBe(10);
    expect(newCandidateCount(c) + c.duplicate).toBe(14);
  });

  it("すべて重複だった場合、新規候補数は 0", () => {
    const c = counts({ duplicate: 12 });
    expect(newCandidateCount(c)).toBe(0);
  });
});
