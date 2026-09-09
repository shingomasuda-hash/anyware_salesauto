"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DiscoveryRunStatusBadge } from "@/components/companies/badges";
import { cancelDiscoveryRunAction } from "@/app/(app)/actions";
import { PROVIDER_LABELS } from "@/lib/discovery/criteria";
import type { DiscoveryRunProgress } from "@/lib/discovery/status";
import type { DiscoveryProviderName, ProviderStat } from "@/lib/discovery/types";

const POLL_MS = 3000;
const KICK_MS = 12000;

const PHASE_LABEL: Record<string, string> = {
  discovering: "候補を発見中…",
  verifying: "本人確認中…",
  promoting: "営業候補へ登録中…",
  done: "完了",
};

/**
 * 探索ランの進捗。
 * - 3秒ごとに進捗を取得
 * - 未完了の間は 12秒ごとに /api/jobs/process を叩いて処理を前進させる（Cron が無い環境でも進む）
 */
export function DiscoveryProgress({ runId, initial }: { runId: string; initial: DiscoveryRunProgress }) {
  const [p, setP] = useState<DiscoveryRunProgress>(initial);
  const [kicking, setKicking] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const lastKick = useRef(0);
  const finished = p.isFinished;

  useEffect(() => {
    if (finished) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/discovery-runs/${runId}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as DiscoveryRunProgress;
          if (!stopped) {
            setP(next);
            if (next.isFinished) router.refresh();
          }
        }
        if (Date.now() - lastKick.current > KICK_MS) {
          lastKick.current = Date.now();
          setKicking(true);
          fetch("/api/jobs/process", { method: "POST", body: JSON.stringify({ maxRuntimeMs: 45000 }), headers: { "Content-Type": "application/json" } })
            .catch(() => undefined)
            .finally(() => setKicking(false));
        }
      } catch {
        /* ignore transient errors */
      }
    };
    const timer = setInterval(tick, POLL_MS);
    tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [runId, finished, router]);

  const run = p.run;
  const target = run.requested_count;
  const pct = target > 0 ? Math.min(100, Math.round((run.promoted_count / target) * 100)) : 0;
  const verifyTotal = p.counts.verified + p.counts.needs_review + p.counts.rejected + p.counts.failed;
  const verifyPct = run.discovered_count > 0 ? Math.min(100, Math.round((verifyTotal / run.discovered_count) * 100)) : 0;
  const stats = Object.entries(p.providerStats) as [DiscoveryProviderName, ProviderStat][];

  return (
    <div className="rounded-lg border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <DiscoveryRunStatusBadge status={run.status} />
          <span className="text-sm text-muted-foreground">
            {finished ? "探索が終了しました" : (PHASE_LABEL[run.phase] ?? "処理中…")}
            {kicking ? " （処理中）" : ""}
          </span>
        </div>
        <div className="flex gap-2">
          {!finished ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await cancelDiscoveryRunAction(runId);
                  if (r?.ok) toast.success(r.message);
                  router.refresh();
                })
              }
            >
              停止
            </Button>
          ) : null}
          {p.counts.needs_review > 0 ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/review">要確認 {p.counts.needs_review}件</Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href="/companies?sort=newest">企業一覧で見る</Link>
          </Button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="発見" value={run.discovered_count} hint="重複排除後の候補数" />
        <Stat label="確認済" value={p.counts.verified} hint="本人確認を通過" />
        <Stat label="要確認" value={p.counts.needs_review} hint="人の判断待ち" />
        <Stat label="対象外" value={p.counts.rejected} hint="条件・確認不足" />
        <Stat label="重複" value={p.counts.duplicate} hint="登録済み企業" />
        <Stat label="登録" value={run.promoted_count} hint={`目標 ${target}社`} />
      </div>

      <div className="mt-5 space-y-3">
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>本人確認</span>
            <span className="tabular-nums">
              {verifyTotal} / {run.discovered_count}件
            </span>
          </div>
          <Progress value={verifyPct} />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>営業候補への登録</span>
            <span className="tabular-nums">
              {run.promoted_count} / {target}社
            </span>
          </div>
          <Progress value={pct} />
        </div>
      </div>

      {stats.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">情報源ごとの内訳</h3>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">情報源</th>
                  <th className="px-3 py-2 text-right font-medium">リクエスト</th>
                  <th className="px-3 py-2 text-right font-medium">取得</th>
                  <th className="px-3 py-2 text-right font-medium">新規候補</th>
                  <th className="px-3 py-2 text-right font-medium">重複</th>
                  <th className="px-3 py-2 text-right font-medium">失敗</th>
                  <th className="px-3 py-2 text-left font-medium">備考</th>
                </tr>
              </thead>
              <tbody>
                {stats.map(([name, s]) => (
                  <tr key={name} className="border-t">
                    <td className="px-3 py-2">{PROVIDER_LABELS[name] ?? name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.requestCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.resultCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.newCandidateCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.duplicateCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.failedCount}</td>
                    <td className="px-3 py-2 text-muted-foreground">{s.skipped ? `未使用: ${s.unavailableReason ?? "設定なし"}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {run.error ? <p className="mt-3 text-sm text-red-700">エラー: {run.error}</p> : null}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
