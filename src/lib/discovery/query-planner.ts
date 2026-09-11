import { getDiscoveryConfig } from "@/lib/config/discovery";
import { generateDirectoryTerms, generateGbizNameKeywords, generateSearchTerms } from "./query-generator";
import { buildShards, citiesFor } from "./query-sharding";
import type { CompanyDiscoveryProvider, DiscoveryCriteria, DiscoveryProviderName, DiscoveryQuery } from "./types";

/**
 * どの Provider に、どの順番で、どの検索語を投げるかを計画する。
 * - GビズINFO: 構造化条件でシャード（市区町村）ごとにページング
 * - Places / Web Search: 業種を細分化した検索語で展開
 * 「大阪府 製造業」1クエリだけを投げることはしない。
 */
export function planQueries(criteria: DiscoveryCriteria, providers: CompanyDiscoveryProvider[]): DiscoveryQuery[] {
  const cfg = getDiscoveryConfig();
  const queries: DiscoveryQuery[] = [];
  const names = providers.map((p) => p.name);

  // 取得目標が大きいほどシャード・検索語を増やす
  const scale = Math.max(1, Math.ceil(criteria.maxResults / 25));
  const shards = buildShards(criteria, citiesFor(criteria.prefecture), Math.min(4 * scale, 12));
  const terms = generateSearchTerms(criteria, Math.min(4 * scale, 12));

  const perProvider: Record<string, Omit<DiscoveryQuery, "id">[]> = { gbiz: [], google_places: [], web_search: [], edinet: [] };

  // 1. GビズINFO: 公的情報の土台（法人番号つきの候補）。
  // 都道府県だけで引くと法人番号順に公的機関（財産区・裁判所等）が並ぶため、
  // 「法人名に現れやすい語」を必ず添えて事業会社を狙う。
  if (names.includes("gbiz")) {
    const nameKeywords = generateGbizNameKeywords(criteria, Math.min(2 * scale, 8));
    const gbizShards = shards.length > 0 ? shards : [{ label: criteria.prefecture ?? "全国" }];
    const pagesPerShard = Math.max(1, Math.ceil(criteria.maxResults / (nameKeywords.length * cfg.perQueryLimit)) || 1);

    if (nameKeywords.length === 0) {
      // 業種未指定など、名前で絞れない場合のみ従来どおり地域シャードで引く
      for (const shard of gbizShards) {
        perProvider.gbiz.push({ provider: "gbiz", criteria, shard, page: 1, limit: cfg.perQueryLimit });
      }
    } else {
      for (let page = 1; page <= pagesPerShard; page++) {
        for (const text of nameKeywords) {
          perProvider.gbiz.push({ provider: "gbiz", criteria, text, page, limit: cfg.perQueryLimit });
        }
      }
    }
  }

  // 2. Google Places: 地域の中小企業・工場を発見する
  if (names.includes("google_places")) {
    for (const text of terms) perProvider.google_places.push({ provider: "google_places", criteria, text, limit: 20 });
  }

  // 3. Web Search: GビズINFO / Places で漏れた企業と公式サイトを補完する
  if (names.includes("web_search")) {
    for (const text of terms) perProvider.web_search.push({ provider: "web_search", criteria, text, limit: 20 });
    // 自治体・工業会などの公開企業一覧ページも候補発見に使う
    for (const text of generateDirectoryTerms(criteria, 2)) perProvider.web_search.push({ provider: "web_search", criteria, text, limit: 20 });
  }

  // 4. EDINET: 上場企業の確認用（キーワード指定時のみ）
  if (names.includes("edinet") && (criteria.keywords?.length ?? 0) > 0) {
    perProvider.edinet.push({ provider: "edinet", criteria, text: criteria.keywords![0], limit: 10 });
  }

  // 実行順は Provider を交互に並べる。
  // GビズINFO を全部投げてから他へ進むと、予算上限に達した時点で
  // 情報源が 1 つしか使われず「複数ソースで突き合わせる」意味が失われるため。
  const order: DiscoveryProviderName[] = ["gbiz", "google_places", "web_search", "edinet"];
  const cursors: Record<string, number> = { gbiz: 0, google_places: 0, web_search: 0, edinet: 0 };
  let seq = 0;
  const push = (q: Omit<DiscoveryQuery, "id">) => queries.push({ ...q, id: `q${seq++}` });

  // 先頭は必ず GビズINFO（法人番号の土台を先に作る）
  if (perProvider.gbiz.length > 0) push(perProvider.gbiz[cursors.gbiz++]);

  let remaining = order.reduce((sum, p) => sum + perProvider[p].length, 0) - cursors.gbiz;
  while (remaining > 0) {
    for (const provider of order) {
      const list = perProvider[provider];
      if (cursors[provider] >= list.length) continue;
      push(list[cursors[provider]++]);
      remaining--;
    }
  }

  return queries;
}

/**
 * 不足分を埋めるための追加クエリ。
 * 目標件数に届かない場合、まだ使っていないページ・検索語で追加探索する。
 */
export function planFallbackQueries(
  criteria: DiscoveryCriteria,
  providers: CompanyDiscoveryProvider[],
  executedQueryIds: string[],
  shortfall: number,
): DiscoveryQuery[] {
  if (shortfall <= 0) return [];
  const cfg = getDiscoveryConfig();
  const names = providers.map((p) => p.name);
  const queries: DiscoveryQuery[] = [];
  let seq = executedQueryIds.length;
  const push = (q: Omit<DiscoveryQuery, "id">) => queries.push({ ...q, id: `fb${seq++}` });

  const extraShards = buildShards(criteria, citiesFor(criteria.prefecture), 12).slice(0, 6);
  const extraTerms = generateSearchTerms(criteria, 12).slice(-6);

  if (names.includes("gbiz")) {
    const extraNames = generateGbizNameKeywords(criteria, 8).slice(-4);
    for (const text of extraNames) push({ provider: "gbiz", criteria, text, page: 2, limit: cfg.perQueryLimit });
    for (const shard of extraShards.slice(0, 2)) push({ provider: "gbiz", criteria, shard, page: 2, limit: cfg.perQueryLimit });
  }
  if (names.includes("web_search")) {
    for (const text of extraTerms) push({ provider: "web_search", criteria, text, limit: 20 });
  }
  if (names.includes("google_places")) {
    for (const text of extraTerms) push({ provider: "google_places", criteria, text, limit: 20 });
  }
  // 不足件数に見合う分だけに絞る（API 乱打の防止）
  return queries.slice(0, Math.max(2, Math.ceil(shortfall / 5)));
}
