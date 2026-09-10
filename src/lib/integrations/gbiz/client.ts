import { requireEnv } from "@/lib/config/env";
import { CORPORATE_TYPES, prefectureCode } from "@/lib/companies/constants";
import { gbizSearchResponseSchema, type CompanySearchConditions, type GbizHojin, type GbizProvider, type GbizSearchPage } from "./types";

const GBIZ_BASE_URL = "https://info.gbiz.go.jp/hojin/v1/hojin";

/**
 * GビズINFO REST API クライアント。
 * 認証は `X-hojinInfo-api-token` ヘッダ。
 * https://info.gbiz.go.jp/hojin/swagger-ui.html
 */
export class GbizClient implements GbizProvider {
  readonly name = "gbiz" as const;

  constructor(private readonly apiKey: string = requireEnv("GBIZ_API_KEY")) {}

  private async request(path: string, params: Record<string, string | number | undefined>): Promise<unknown> {
    const url = new URL(`${GBIZ_BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      headers: { "X-hojinInfo-api-token": this.apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) throw new Error("GビズINFO: レート制限 (429)。しばらく待って再試行してください");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GビズINFO API エラー: HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async search(conditions: CompanySearchConditions, page: number, limit: number): Promise<GbizSearchPage> {
    const params: Record<string, string | number | undefined> = {
      page,
      limit,
      prefecture: prefectureCode(conditions.prefecture),
      name: conditions.keyword?.trim() || undefined,
      employee_number_from: conditions.employeeMin,
      employee_number_to: conditions.employeeMax,
      corporate_type: conditions.corporateType ? CORPORATE_TYPES.find((c) => c.code === conditions.corporateType)?.code : undefined,
    };
    // 業種: GビズINFO の business_item は独自コード体系のため API 側では絞らず、
    // 取得後に mapping.ts の matchesIndustry でローカルフィルタする。
    const json = await this.request("", params);
    const parsed = gbizSearchResponseSchema.safeParse(json);
    if (!parsed.success) {
      // 想定外の形でも、どの項目が合わなかったかだけを簡潔に出す（レスポンス本文は出さない）
      const where = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).slice(0, 3).join(" / ");
      throw new Error(`GビズINFO レスポンス形式が不正: ${where}`);
    }
    const data = parsed.data;
    if (data.errors && data.errors.length > 0) {
      throw new Error(`GビズINFO API エラー: ${JSON.stringify(data.errors).slice(0, 300)}`);
    }
    return {
      items: data["hojin-infos"] ?? [],
      page: Number(data.pageNumber ?? page),
      totalPages: Number(data.totalPage ?? 0),
      totalCount: Number(data.totalCount ?? 0),
    };
  }

  async detail(corporateNumber: string): Promise<GbizHojin | null> {
    const json = await this.request(`/${corporateNumber}`, {});
    const parsed = gbizSearchResponseSchema.safeParse(json);
    if (!parsed.success) return null;
    return parsed.data["hojin-infos"]?.[0] ?? null;
  }
}
