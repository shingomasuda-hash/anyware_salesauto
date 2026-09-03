import { describe, expect, it } from "vitest";
import { computeSalesPriorityScore, isContactable, rankFromScore } from "../priority";

describe("computeSalesPriorityScore", () => {
  it("weights issue scores positively and quality scores inversely", () => {
    const high = computeSalesPriorityScore({ recruitment_issue_score: 90, dx_opportunity_score: 80, growth_potential_score: 80, web_quality_score: 20, sns_activity_score: 10, digital_marketing_score: 10 });
    const low = computeSalesPriorityScore({ recruitment_issue_score: 10, dx_opportunity_score: 10, growth_potential_score: 20, web_quality_score: 90, sns_activity_score: 90, digital_marketing_score: 90 });
    expect(high).toBeGreaterThan(80);
    expect(low).toBeLessThan(20);
  });
  it("ignores null sub-scores and returns null when nothing is known", () => {
    expect(computeSalesPriorityScore({ recruitment_issue_score: 80, dx_opportunity_score: null, growth_potential_score: null, web_quality_score: null, sns_activity_score: null, digital_marketing_score: null })).toBe(80);
    expect(computeSalesPriorityScore({ recruitment_issue_score: null, dx_opportunity_score: null, growth_potential_score: null, web_quality_score: null, sns_activity_score: null, digital_marketing_score: null })).toBeNull();
  });
  it("clamps to 0-100 and rounds", () => {
    const v = computeSalesPriorityScore({ recruitment_issue_score: 100, dx_opportunity_score: 100, growth_potential_score: 100, web_quality_score: 0, sns_activity_score: 0, digital_marketing_score: 0 });
    expect(v).toBe(100);
  });
});

describe("rankFromScore", () => {
  it("maps thresholds", () => {
    expect(rankFromScore(75)).toBe("A");
    expect(rankFromScore(74)).toBe("B");
    expect(rankFromScore(55)).toBe("B");
    expect(rankFromScore(35)).toBe("C");
    expect(rankFromScore(34)).toBe("D");
    expect(rankFromScore(null)).toBeNull();
  });
  it("contactable excludes restricted companies regardless of rank", () => {
    expect(isContactable("false")).toBe(false);
    expect(isContactable("true")).toBe(true);
    expect(isContactable("unknown")).toBe(true);
  });
});
