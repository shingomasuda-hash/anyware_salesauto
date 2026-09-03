import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { JobStatus, SalesContactAllowed, SalesRank, VerificationStatus } from "@/lib/db/types";

export function RankBadge({ rank }: { rank: SalesRank | null | undefined }) {
  if (!rank) return <span className="text-muted-foreground">—</span>;
  const styles: Record<SalesRank, string> = {
    A: "bg-emerald-600 text-white",
    B: "bg-sky-600 text-white",
    C: "bg-slate-500 text-white",
    D: "bg-slate-200 text-slate-600",
  };
  return <span className={cn("inline-flex size-6 items-center justify-center rounded text-xs font-semibold", styles[rank])}>{rank}</span>;
}

/** 0-100 スコア。invert=true は低いほど課題（Web/SNS）として色付け */
export function ScoreCell({ value, invert = false }: { value: number | null | undefined; invert?: boolean }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  const v = invert ? 100 - value : value;
  const color = v >= 70 ? "bg-emerald-500" : v >= 45 ? "bg-amber-400" : "bg-slate-300";
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="w-7 text-right">{Math.round(value)}</span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", color)} style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
      </span>
    </span>
  );
}

export function ContactAllowedBadge({ value }: { value: SalesContactAllowed }) {
  if (value === "false") return <Badge variant="danger">営業不可</Badge>;
  if (value === "true") return <Badge variant="success">可</Badge>;
  return <Badge variant="muted">不明</Badge>;
}

export function VerificationBadge({ value, confidence }: { value: VerificationStatus; confidence?: number | null }) {
  const map: Record<VerificationStatus, { label: string; variant: "success" | "warning" | "muted" | "info" | "danger" }> = {
    verified: { label: "公式確認済", variant: "success" },
    manual: { label: "手動設定", variant: "info" },
    needs_review: { label: "要確認", variant: "warning" },
    unverified: { label: "未確認", variant: "muted" },
    no_website: { label: "HPなし", variant: "muted" },
  };
  const m = map[value];
  return (
    <Badge variant={m.variant}>
      {m.label}
      {confidence !== null && confidence !== undefined && (value === "verified" || value === "needs_review") ? ` ${confidence}` : ""}
    </Badge>
  );
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; variant: "success" | "warning" | "muted" | "info" | "danger" }> = {
    pending: { label: "待機中", variant: "muted" },
    processing: { label: "処理中", variant: "info" },
    completed: { label: "完了", variant: "success" },
    failed: { label: "失敗", variant: "danger" },
    retrying: { label: "再試行待ち", variant: "warning" },
    cancelled: { label: "キャンセル", variant: "muted" },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function YesNo({ value }: { value: boolean | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return value ? <span className="text-emerald-600">●</span> : <span className="text-muted-foreground">–</span>;
}
