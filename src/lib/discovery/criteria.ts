import { z } from "zod";
import { COMPANY_SIZE_PRESETS, CORPORATE_TYPES, INDUSTRIES, PREFECTURE_NAMES } from "@/lib/companies/constants";
import { findSubcategory } from "./taxonomy";
import type { DiscoveryCriteria, DiscoveryMode } from "./types";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const checkbox = (v: unknown) => v === "on" || v === "true" || v === true;

export const DISCOVERY_MODE_OPTIONS: { key: DiscoveryMode | "auto"; label: string; hint: string }[] = [
  { key: "auto", label: "自動（推奨）", hint: "利用できる情報源をすべて使い、複数ソースで突き合わせます" },
  { key: "gbiz", label: "GビズINFO のみ", hint: "法人番号つきの公的データだけを使います" },
  { key: "places", label: "Google Places のみ", hint: "地図データから地域の企業を探します" },
  { key: "search", label: "Web検索のみ", hint: "検索エンジンから候補を探します（要確認が増えます）" },
];

/** 「企業を探す」フォーム（Multi-Source Discovery）の入力スキーマ */
export const discoveryCriteriaSchema = z.object({
  prefecture: z.preprocess(emptyToUndefined, z.enum(PREFECTURE_NAMES as [string, ...string[]]).optional()),
  city: z.preprocess(emptyToUndefined, z.string().max(50).optional()),
  industry: z.preprocess(emptyToUndefined, z.enum(INDUSTRIES.map((i) => i.key) as [string, ...string[]]).optional()),
  industrySubcategory: z.preprocess(emptyToUndefined, z.string().max(50).optional()),
  keyword: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  companySize: z.preprocess(emptyToUndefined, z.enum(COMPANY_SIZE_PRESETS.map((p) => p.key) as [string, ...string[]]).optional()),
  employeeMin: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(1_000_000).optional()),
  employeeMax: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(1_000_000).optional()),
  corporateType: z.preprocess(emptyToUndefined, z.enum(CORPORATE_TYPES.map((c) => c.code) as [string, ...string[]]).optional()),
  requestedCount: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(500).default(50)),
  mode: z.preprocess(emptyToUndefined, z.enum(["auto", "gbiz", "places", "search", "hybrid"]).default("auto")),
  requireRecruiting: z.preprocess(checkbox, z.boolean().default(false)),
  requireWebsite: z.preprocess(checkbox, z.boolean().default(true)),
});

export type DiscoveryCriteriaInput = z.infer<typeof discoveryCriteriaSchema>;

/** フォーム入力 → 探索条件（企業規模プリセットを従業員数レンジに展開） */
export function toDiscoveryCriteria(input: DiscoveryCriteriaInput): DiscoveryCriteria {
  let employeeMin = input.employeeMin;
  let employeeMax = input.employeeMax;
  if (input.companySize && input.companySize !== "any") {
    const preset = COMPANY_SIZE_PRESETS.find((p) => p.key === input.companySize);
    if (preset) {
      employeeMin = employeeMin ?? (preset.min > 0 ? preset.min : undefined);
      employeeMax = employeeMax ?? (preset.max ?? undefined);
    }
  }
  return {
    prefecture: input.prefecture,
    city: input.city,
    industry: input.industry,
    industrySubcategory: input.industrySubcategory,
    keywords: input.keyword ? [input.keyword] : undefined,
    employeeMin,
    employeeMax,
    companyType: input.corporateType,
    recruitingRequired: input.requireRecruiting,
    websiteRequired: input.requireWebsite,
    maxResults: input.requestedCount,
  };
}

/** "auto" は環境変数 DISCOVERY_MODE に委ねる（undefined を返す） */
export function toDiscoveryMode(mode: DiscoveryCriteriaInput["mode"]): DiscoveryMode | undefined {
  return mode === "auto" ? undefined : (mode as DiscoveryMode);
}

export function describeDiscoveryCriteria(c: DiscoveryCriteria): string {
  const parts: string[] = [];
  if (c.prefecture) parts.push(c.prefecture);
  if (c.city) parts.push(c.city);
  if (c.industry) parts.push(INDUSTRIES.find((i) => i.key === c.industry)?.label ?? c.industry);
  const sub = findSubcategory(c.industry, c.industrySubcategory);
  if (sub) parts.push(sub.label);
  if (c.keywords?.length) parts.push(`"${c.keywords.join(" ")}"`);
  if (c.employeeMin !== undefined || c.employeeMax !== undefined) parts.push(`${c.employeeMin ?? ""}〜${c.employeeMax ?? ""}名`);
  if (c.companyType) parts.push(CORPORATE_TYPES.find((t) => t.code === c.companyType)?.label ?? c.companyType);
  parts.push(`${c.maxResults}社`);
  return parts.join(" / ");
}

/** DB に保存した条件を読み戻す（欠損値は既定値で補う） */
export function parseStoredCriteria(raw: unknown): DiscoveryCriteria {
  const o = (raw ?? {}) as Partial<DiscoveryCriteria>;
  return {
    ...o,
    recruitingRequired: o.recruitingRequired ?? false,
    websiteRequired: o.websiteRequired ?? true,
    maxResults: o.maxResults ?? 50,
  };
}

export const PROVIDER_LABELS: Record<string, string> = {
  gbiz: "GビズINFO",
  google_places: "Google Places",
  web_search: "Web検索",
  edinet: "EDINET",
  official_web: "公式サイト確認",
};
