import { z } from "zod";

/** GビズINFO 法人基本情報（レスポンスは項目の有無が揺れるため全て optional + passthrough） */
export const gbizHojinSchema = z
  .object({
    corporate_number: z.string().optional(),
    name: z.string().optional(),
    kana: z.string().nullable().optional(),
    name_en: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    postal_code: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    update_date: z.string().nullable().optional(),
    company_url: z.string().nullable().optional(),
    business_summary: z.string().nullable().optional(),
    business_items: z.array(z.string()).nullable().optional(),
    employee_number: z.union([z.number(), z.string()]).nullable().optional(),
    capital_stock: z.union([z.number(), z.string()]).nullable().optional(),
    date_of_establishment: z.string().nullable().optional(),
    founding_year: z.union([z.number(), z.string()]).nullable().optional(),
    representative_name: z.string().nullable().optional(),
    representative_position: z.string().nullable().optional(),
    company_size_male: z.union([z.number(), z.string()]).nullable().optional(),
    company_size_female: z.union([z.number(), z.string()]).nullable().optional(),
    kind: z.string().nullable().optional(),
    close_date: z.string().nullable().optional(),
    close_cause: z.string().nullable().optional(),
  })
  .passthrough();

export type GbizHojin = z.infer<typeof gbizHojinSchema>;

/**
 * 検索レスポンス。
 * GビズINFO は正常応答でも id / errors を null で返すことがあるため、
 * 全項目を nullable にして「解析できない」と誤判定しないようにする。
 */
export const gbizSearchResponseSchema = z
  .object({
    id: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    totalCount: z.union([z.number(), z.string()]).nullable().optional(),
    totalPage: z.union([z.number(), z.string()]).nullable().optional(),
    pageNumber: z.union([z.number(), z.string()]).nullable().optional(),
    "hojin-infos": z.array(gbizHojinSchema).nullable().optional(),
    errors: z.array(z.unknown()).nullable().optional(),
  })
  .passthrough();

export type GbizSearchResponse = z.infer<typeof gbizSearchResponseSchema>;

/** 企業検索の条件（UI から渡される） */
export interface CompanySearchConditions {
  prefecture?: string;
  city?: string;
  industry?: string;
  keyword?: string;
  employeeMin?: number;
  employeeMax?: number;
  corporateType?: string;
  requestedCount: number;
  requireRecruiting?: boolean;
  requireWebsite?: boolean;
}

export interface GbizSearchPage {
  items: GbizHojin[];
  page: number;
  totalPages: number;
  totalCount: number;
}

export interface GbizProvider {
  readonly name: "gbiz" | "mock";
  search(conditions: CompanySearchConditions, page: number, limit: number): Promise<GbizSearchPage>;
  detail(corporateNumber: string): Promise<GbizHojin | null>;
}
