"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { JobStatusBadge } from "@/components/companies/badges";
import { cancelSearchJobAction, retryFailedJobsAction } from "@/app/(app)/actions";
import type { SearchJobProgress } from "@/lib/jobs/status";

const POLL_MS = 3000;
const KICK_MS = 12000;

/**
 * 検索ジョブ進捗。
 * - 3秒ごとに進捗を取得
 * - 未完了の間は 12秒ごとに /api/jobs/process を叩いて処理を前進させる（Cron が無い環境でも進む）
 */
export function SearchProgress({ jobId, initial }: { jobId: string; initial: SearchJobProgress }) {
  const [p, setP] = useState<SearchJobProgress>(initial);
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
        const res = await fetch(`/api/search-jobs/${jobId}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as SearchJobProgress;
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
  }, [jobId, finished, router]);

  const job = p.job;
  const target = job.requested_count;
  const pct = target > 0 ? Math.min(100, Math.round((job.registered_count / target) * 100)) : 0;
  const analyzedPct = p.crawl.total > 0 ? Math.round((p.analysis.completed / Math.max(p.crawl.total, 1)) * 100) : 0;
  const failed = p.crawl.failed + p.analysis.failed;

  return (
    <div className="rounded-lg border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <JobStatusBadge status={job.status} />
          <span className="text-sm text-muted-foreground">
            {finished ? "すべての処理が完了しました" : job.status === "processing" || job.status === "pending" || job.status === "retrying" ? "検索中…" : p.crawl.pending + p.analysis.pending > 0 ? "解析中…" : "待機中"}
            {kicking ? " （処理中）" : ""}
          </span>
        </div>
        <div className="flex gap-2">
          {failed > 0 ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await retryFailedJobsAction({ searchJobId: jobId });
                  if (r?.ok) toast.success(r.message);
                  else toast.error(r?.message ?? "失敗");
                  router.refresh();
                })
              }
            >
              失敗した{failed}件を再実行
            </Button>
          ) : null}
          {!finished && ["pending", "processing", "retrying"].includes(job.status) ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await cancelSearchJobAction(jobId);
                  if (r?.ok) toast.success(r.message);
                  router.refresh();
                })
              }
            >
              キャンセル
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href="/companies?sort=newest">企業一覧で見る</Link>
          </Button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="発見" value={job.found_count} hint="候補取得数" />
        <Stat label="登録済み" value={job.registered_count} hint={`目標 ${target}社`} />
        <Stat label="新規" value={job.new_count} hint={`重複 ${job.duplicate_count}`} />
        <Stat label="対象外" value={job.skipped_count} hint="条件不一致など" />
        <Stat label="クロール完了" value={p.crawl.completed} hint={`待ち ${p.crawl.pending} / 失敗 ${p.crawl.failed}`} />
        <Stat label="解析完了" value={p.analysis.completed} hint={`待ち ${p.analysis.pending} / 失敗 ${p.analysis.failed}`} />
      </div>

      <div className="mt-5 space-y-3">
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>企業登録</span>
            <span className="tabular-nums">
              {job.registered_count} / {target}社
            </span>
          </div>
          <Progress value={pct} />
        </div>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>AI分析</span>
            <span className="tabular-nums">
              {p.analysis.completed} / {p.crawl.total}社
            </span>
          </div>
          <Progress value={analyzedPct} />
        </div>
      </div>
      {p.needsReview > 0 ? (
        <p className="mt-4 text-sm text-amber-700">
          公式サイトを断定できなかった企業が {p.needsReview} 社あります。{" "}
          <Link href="/companies?needsReview=1" className="underline">
            要確認一覧
          </Link>
        </p>
      ) : null}
      {job.error ? <p className="mt-3 text-sm text-red-700">エラー: {job.error}</p> : null}
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
