import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { getRequestDb } from "@/lib/supabase/request-db";
import { formatDate, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "ログ" };

const CATEGORIES = ["search", "company", "crawl", "analysis", "api", "job", "auth", "system"];
const LEVELS = ["info", "warn", "error"];

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ category?: string; level?: string; tab?: string }> }) {
  const sp = await searchParams;
  const db = await getRequestDb();
  const tab = sp.tab === "ai" ? "ai" : "system";

  let q = db.from("system_logs").select("*").order("created_at", { ascending: false }).limit(200);
  if (sp.category) q = q.eq("category", sp.category);
  if (sp.level && LEVELS.includes(sp.level)) q = q.eq("level", sp.level as "info" | "warn" | "error");
  const [logs, usage] = await Promise.all([tab === "system" ? q : Promise.resolve({ data: [] }), tab === "ai" ? db.from("ai_usage_logs").select("*, companies(company_name)").order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] })]);
  const usageRows = usage.data ?? [];
  const totals = usageRows.reduce(
    (acc, r) => ({ input: acc.input + r.input_tokens, output: acc.output + r.output_tokens, cacheRead: acc.cacheRead + r.cache_read_tokens }),
    { input: 0, output: 0, cacheRead: 0 },
  );

  return (
    <div>
      <PageHeader title="ログ" description="企業検索 / 登録 / クロール / AI分析 / API利用 / エラー の記録" />
      <div className="mb-4 flex gap-2">
        <Button asChild size="sm" variant={tab === "system" ? "default" : "outline"}>
          <Link href="/logs">システムログ</Link>
        </Button>
        <Button asChild size="sm" variant={tab === "ai" ? "default" : "outline"}>
          <Link href="/logs?tab=ai">AI API 使用量</Link>
        </Button>
      </div>

      {tab === "system" ? (
        <>
          <form method="get" className="mb-3 flex flex-wrap gap-2">
            <NativeSelect name="category" defaultValue={sp.category ?? ""} className="w-40">
              <option value="">全カテゴリ</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect name="level" defaultValue={sp.level ?? ""} className="w-32">
              <option value="">全レベル</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </NativeSelect>
            <Button type="submit" size="sm" variant="outline">
              絞り込む
            </Button>
          </form>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>レベル</TableHead>
                  <TableHead>カテゴリ</TableHead>
                  <TableHead>メッセージ</TableHead>
                  <TableHead>企業</TableHead>
                  <TableHead>詳細</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logs.data ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      ログはありません
                    </TableCell>
                  </TableRow>
                ) : (
                  (logs.data ?? []).map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-muted-foreground">{formatDate(l.created_at, true)}</TableCell>
                      <TableCell>
                        <Badge variant={l.level === "error" ? "danger" : l.level === "warn" ? "warning" : "muted"}>{l.level}</Badge>
                      </TableCell>
                      <TableCell>{l.category}</TableCell>
                      <TableCell className="max-w-md whitespace-normal">{l.message}</TableCell>
                      <TableCell>
                        {l.company_id ? (
                          <Link href={`/companies/${l.company_id}`} className="text-xs hover:underline">
                            企業
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-md">
                        {l.meta ? (
                          <details>
                            <summary className="cursor-pointer text-xs text-muted-foreground">meta</summary>
                            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-[11px]">{JSON.stringify(l.meta, null, 1)}</pre>
                          </details>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 flex gap-6 text-sm text-muted-foreground">
            <span>
              直近{usageRows.length}件 · 入力 <b className="text-foreground tabular-nums">{formatNumber(totals.input)}</b> tokens
            </span>
            <span>
              出力 <b className="text-foreground tabular-nums">{formatNumber(totals.output)}</b> tokens
            </span>
            <span>
              キャッシュ読取 <b className="text-foreground tabular-nums">{formatNumber(totals.cacheRead)}</b> tokens
            </span>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>企業</TableHead>
                  <TableHead>用途</TableHead>
                  <TableHead>モデル</TableHead>
                  <TableHead className="text-right">入力</TableHead>
                  <TableHead className="text-right">出力</TableHead>
                  <TableHead className="text-right">キャッシュ</TableHead>
                  <TableHead className="text-right">時間</TableHead>
                  <TableHead>結果</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usageRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                      記録はありません
                    </TableCell>
                  </TableRow>
                ) : (
                  usageRows.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="text-muted-foreground">{formatDate(u.created_at, true)}</TableCell>
                      <TableCell>
                        {u.company_id ? (
                          <Link href={`/companies/${u.company_id}`} className="hover:underline">
                            {u.companies?.company_name ?? "企業"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>{u.purpose}</TableCell>
                      <TableCell className="text-muted-foreground">{u.model}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(u.input_tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(u.output_tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(u.cache_read_tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{u.duration_ms !== null ? `${(u.duration_ms / 1000).toFixed(1)}s` : "—"}</TableCell>
                      <TableCell>{u.success ? <Badge variant="success">成功</Badge> : <Badge variant="danger" title={u.error ?? undefined}>失敗</Badge>}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
