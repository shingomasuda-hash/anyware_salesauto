import { GbizClient } from "@/lib/integrations/gbiz/client";
import { matchesConditions } from "@/lib/integrations/gbiz/mapping";
import { getEnv, isMockMode } from "@/lib/config/env";
import { INDUSTRIES } from "@/lib/companies/constants";
import { toCandidate } from "../normalizer";
import { withRetry } from "../retry";
import type { CompanyDiscoveryProvider, DiscoveryCandidate, DiscoveryContext, DiscoveryQuery, MergedCandidate } from "../types";

/**
 * GビズINFO Provider。
 * 法人番号・法人名・所在地・法人種別の Source of Truth として使う。
 * 企業「発見」の唯一の手段にはせず、他 Provider と組み合わせる。
 */
export class GbizDiscoveryProvider implements CompanyDiscoveryProvider {
  readonly name = "gbiz" as const;

  isAvailable(): boolean {
    return isMockMode() || Boolean(getEnv().GBIZ_API_KEY);
  }

  unavailableReason(): string | null {
    return this.isAvailable() ? null : "GBIZ_API_KEY が未設定です";
  }

  private client(): GbizClient {
    return new GbizClient(getEnv().GBIZ_API_KEY!);
  }

  async search(query: DiscoveryQuery, context: DiscoveryContext): Promise<DiscoveryCandidate[]> {
    const criteria = { ...query.criteria };
    if (query.shard?.city) criteria.city = query.shard.city;

    const conditions = {
      prefecture: criteria.prefecture,
      city: criteria.city,
      industry: criteria.industry,
      keyword: query.text || criteria.keywords?.[0],
      employeeMin: criteria.employeeMin,
      employeeMax: criteria.employeeMax,
      corporateType: criteria.companyType,
      requestedCount: criteria.maxResults,
    };

    const page = await withRetry(() => this.client().search(conditions, query.page ?? 1, query.limit ?? 30), {
      maxAttempts: 3,
      onRetry: (attempt, delay) => void context.log("warn", `GビズINFO を再試行します (${attempt}回目, ${delay}ms待機)`),
    });

    const out: DiscoveryCandidate[] = [];
    for (const item of page.items) {
      if (!item.name) continue;
      // 業種・市区町村・従業員数は API で絞れないためローカルで判定する
      const match = matchesConditions(item, conditions);
      if (!match.ok) continue;
      out.push(
        toCandidate({
          name: item.name,
          address: item.location ?? null,
          corporateNumber: item.corporate_number ?? null,
          website: item.company_url ?? null,
          industry: criteria.industry ?? inferIndustry(item.business_items ?? [], item.business_summary ?? ""),
          source: "gbiz",
          sourceId: item.corporate_number ?? null,
          sourceUrl: item.corporate_number ? `https://info.gbiz.go.jp/hojin/ichiran?hojinBangou=${item.corporate_number}` : null,
          // 公的登録情報のため単体でも信頼度が高い
          sourceConfidence: 90,
          rawData: item,
        }),
      );
    }
    return out;
  }

  /** 会社名と所在地から法人番号を引き当てる（他 Provider 由来の候補を公的情報で裏付ける） */
  async enrich(candidate: MergedCandidate, context: DiscoveryContext): Promise<DiscoveryCandidate | null> {
    if (candidate.corporateNumber || !this.isAvailable()) return null;
    if (isMockMode()) return null;
    if (!context.budget.canVerificationRequest()) return null;
    context.budget.consumeVerificationRequest();

    try {
      const page = await withRetry(
        () =>
          this.client().search(
            { prefecture: candidate.prefecture ?? undefined, keyword: candidate.name, requestedCount: 5 },
            1,
            5,
          ),
        { maxAttempts: 2 },
      );
      const nameNorm = candidate.normalizedName;
      const hit = page.items.find((i) => {
        if (!i.name) return false;
        const c = toCandidate({ name: i.name, address: i.location ?? null, source: "gbiz", sourceConfidence: 90 });
        if (c.normalizedName !== nameNorm) return false;
        // 所在地が分かる場合は都道府県まで一致を要求する（同名企業の誤結合を防ぐ）
        if (candidate.prefecture && c.prefecture && c.prefecture !== candidate.prefecture) return false;
        return true;
      });
      if (!hit?.name) return null;
      return toCandidate({
        name: hit.name,
        address: hit.location ?? null,
        corporateNumber: hit.corporate_number ?? null,
        website: hit.company_url ?? null,
        source: "gbiz",
        sourceId: hit.corporate_number ?? null,
        sourceUrl: hit.corporate_number ? `https://info.gbiz.go.jp/hojin/ichiran?hojinBangou=${hit.corporate_number}` : null,
        sourceConfidence: 90,
        rawData: hit,
      });
    } catch (err) {
      await context.log("warn", "GビズINFO による法人確認に失敗", { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
}

function inferIndustry(items: string[], summary: string): string | null {
  const hay = `${items.join(" ")} ${summary}`;
  for (const ind of INDUSTRIES) {
    if (ind.gbizKeywords.some((k) => hay.includes(k))) return ind.key;
  }
  return null;
}
