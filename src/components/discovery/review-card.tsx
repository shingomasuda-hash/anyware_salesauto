"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approveCandidateAction, correctCandidateWebsiteAction, rejectCandidateAction } from "@/app/(app)/actions";
import { PROVIDER_LABELS } from "@/lib/discovery/criteria";
import type { DiscoveryCandidateRow } from "@/db/types";
import type { VerificationSignal } from "@/lib/discovery/verifier";

/**
 * 要確認候補の 1 件。承認 / 却下 / 公式HP修正 を行う。
 * 承認するまで companies には登録されない。
 */
export function ReviewCard({ candidate, runName }: { candidate: DiscoveryCandidateRow & { run_name?: string | null }; runName?: string | null }) {
  const [website, setWebsite] = useState(candidate.website ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  const signals = (Array.isArray(candidate.verification_signals) ? candidate.verification_signals : []) as unknown as VerificationSignal[];
  const sources = candidate.sources.length > 0 ? candidate.sources : [candidate.primary_source];

  const run = (fn: () => Promise<{ ok: boolean; message?: string } | null>) =>
    start(async () => {
      const r = await fn();
      if (r?.ok) toast.success(r.message ?? "更新しました");
      else toast.error(r?.message ?? "失敗しました");
      router.refresh();
    });

  return (
    <div className="rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{candidate.name}</h3>
          <p className="text-xs text-muted-foreground">
            {candidate.address ?? "所在地不明"}
            {candidate.phone ? ` ／ ${candidate.phone}` : ""}
            {candidate.corporate_number ? ` ／ 法人番号 ${candidate.corporate_number}` : " ／ 法人番号なし"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            情報源: {sources.map((s) => PROVIDER_LABELS[s] ?? s).join(" / ")}
            {runName ?? candidate.run_name ? ` ／ 探索: ${runName ?? candidate.run_name}` : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">本人確認スコア</div>
          <div className="text-2xl font-semibold tabular-nums">{candidate.verification_score ?? 0}</div>
          {candidate.official_site_confidence !== null ? (
            <div className="text-[11px] text-muted-foreground">公式サイト確度 {candidate.official_site_confidence}</div>
          ) : null}
        </div>
      </div>

      {signals.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {signals.map((s) => (
            <li
              key={s.key}
              className={s.matched ? "rounded bg-emerald-50 px-2 py-1 text-emerald-800" : "rounded bg-muted px-2 py-1 text-muted-foreground"}
            >
              {s.matched ? "✓" : "×"} {s.label}
              {s.detail ? `（${s.detail}）` : ""}
            </li>
          ))}
        </ul>
      ) : null}

      {candidate.reject_reason ? <p className="mt-3 text-xs text-amber-700">{candidate.reject_reason}</p> : null}

      <div className="mt-4 space-y-2">
        <label className="text-xs text-muted-foreground" htmlFor={`website-${candidate.id}`}>
          公式サイト（間違っていれば修正してください）
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={`website-${candidate.id}`}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://example.co.jp"
            className="min-w-[240px] flex-1"
          />
          <Button
            variant="outline"
            disabled={pending || !website.trim() || website.trim() === (candidate.website ?? "")}
            onClick={() => run(() => correctCandidateWebsiteAction(candidate.id, website.trim()))}
          >
            修正して再確認
          </Button>
        </div>
        {candidate.website ? (
          <a href={candidate.website} target="_blank" rel="noreferrer noopener" className="inline-block text-xs underline">
            サイトを開いて確認する
          </a>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={pending} onClick={() => run(() => rejectCandidateAction(candidate.id, "確認の結果、対象外と判断"))}>
          対象外にする
        </Button>
        <Button disabled={pending} onClick={() => run(() => approveCandidateAction(candidate.id, website.trim() || undefined))}>
          承認して企業に登録
        </Button>
      </div>
    </div>
  );
}
