import { z } from "zod";
import { COMPANY_SIZE_PRESETS, CORPORATE_TYPES, INDUSTRIES, PREFECTURE_NAMES } from "@/lib/companies/constants";
import type { CompanySearchConditions } from "@/lib/integrations/gbiz/types";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** 「企業を探す」フォームの入力スキーマ */
export const searchConditionsSchema = z.object({
  prefecture: z.preprocess(emptyToUndefined, z.enum(PREFECTURE_NAMES as [string, ...string[]]).optional()),
  city: z.preprocess(emptyToUndefined, z.string().max(50).optional()),
  industry: z.preprocess(emptyToUndefined, z.enum(INDUSTRIES.map((i) => i.key) as [string, ...string[]]).optional()),
  keyword: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  companySize: z.preprocess(emptyToUndefined, z.enum(COMPANY_SIZE_PRESETS.map((p) => p.key) as [string, ...string[]]).optional()),
  employeeMin: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(1_000_000).optional()),
  employeeMax: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(1_000_000).optional()),
  corporateType: z.preprocess(emptyToUndefined, z.enum(CORPORATE_TYPES.map((c) => c.code) as [string, ...string[]]).optional()),
  requestedCount: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(500).default(100)),
  requireRecruiting: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean().default(false)),
  requireWebsite: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean().default(false)),
});

export type SearchConditionsInput = z.infer<typeof searchConditionsSchema>;

/** フォーム入力 → 検索条件（プリセットを従業員数レンジに展開） */
export function toSearchConditions(input: SearchConditionsInput): CompanySearchConditions {
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
    keyword: input.keyword,
    employeeMin,
    employeeMax,
    corporateType: input.corporateType,
    requestedCount: input.requestedCount,
    requireRecruiting: input.requireRecruiting,
    requireWebsite: input.requireWebsite,
  };
}

export function describeConditions(c: CompanySearchConditions): string {
  const parts: string[] = [];
  if (c.prefecture) parts.push(c.prefecture);
  if (c.city) parts.push(c.city);
  if (c.industry) parts.push(INDUSTRIES.find((i) => i.key === c.industry)?.label ?? c.industry);
  if (c.keyword) parts.push(`"${c.keyword}"`);
  if (c.employeeMin !== undefined || c.employeeMax !== undefined) parts.push(`${c.employeeMin ?? ""}〜${c.employeeMax ?? ""}名`);
  if (c.corporateType) parts.push(CORPORATE_TYPES.find((t) => t.code === c.corporateType)?.label ?? c.corporateType);
  parts.push(`${c.requestedCount}社`);
  return parts.join(" / ");
}

export function parseStoredConditions(raw: unknown): CompanySearchConditions {
  const obj = (raw ?? {}) as Partial<CompanySearchConditions>;
  return {
    prefecture: obj.prefecture,
    city: obj.city,
    industry: obj.industry,
    keyword: obj.keyword,
    employeeMin: obj.employeeMin,
    employeeMax: obj.employeeMax,
    corporateType: obj.corporateType,
    requestedCount: obj.requestedCount ?? 100,
    requireRecruiting: obj.requireRecruiting ?? false,
    requireWebsite: obj.requireWebsite ?? false,
  };
}
