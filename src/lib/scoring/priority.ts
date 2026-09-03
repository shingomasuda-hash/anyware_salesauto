import type { SalesRank } from "@/lib/db/types";

export interface SubScores {
  recruitment_issue_score: number | null;
  web_quality_score: number | null;
  sns_activity_score: number | null;
  digital_marketing_score: number | null;
  dx_opportunity_score: number | null;
  growth_potential_score: number | null;
}

/**
 * 総合営業優先度の算出（決定論的・テスト可能）。
 * 汎用営業基盤として「課題の大きさ」と「支援余地」を中心に重み付けする。
 * - 採用課題 / DX余地 / 成長可能性 は高いほど優先
 * - Web / SNS / デジタルマーケ は "低い" ほど支援余地があるため反転して加点
 * 不明(null)の要素は分母から除外する。
 */
export function computeSalesPriorityScore(s: SubScores): number | null {
  const parts: { value: number; weight: number }[] = [];
  const push = (v: number | null, weight: number, invert = false) => {
    if (v === null || v === undefined || Number.isNaN(v)) return;
    const clamped = clamp(v);
    parts.push({ value: invert ? 100 - clamped : clamped, weight });
  };
  push(s.recruitment_issue_score, 0.3);
  push(s.dx_opportunity_score, 0.2);
  push(s.growth_potential_score, 0.2);
  push(s.web_quality_score, 0.1, true);
  push(s.sns_activity_score, 0.1, true);
  push(s.digital_marketing_score, 0.1, true);
  if (parts.length === 0) return null;
  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  const score = parts.reduce((a, p) => a + p.value * p.weight, 0) / totalWeight;
  return Math.round(clamp(score));
}

export function rankFromScore(score: number | null): SalesRank | null {
  if (score === null) return null;
  if (score >= 75) return "A";
  if (score >= 55) return "B";
  if (score >= 35) return "C";
  return "D";
}

export function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

/** 営業連絡が可能か（拒否表記がある企業はスコアに関わらず不可） */
export function isContactable(salesContactAllowed: "true" | "false" | "unknown"): boolean {
  return salesContactAllowed !== "false";
}
