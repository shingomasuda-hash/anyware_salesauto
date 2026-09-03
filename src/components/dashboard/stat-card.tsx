import Link from "next/link";
import { formatNumber } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

export function StatCard({ label, value, href, hint, tone }: { label: string; value: number; href?: string; hint?: string; tone?: "default" | "warning" | "danger" }) {
  const body = (
    <div className={cn("rounded-lg border px-4 py-3 transition-colors", href && "hover:bg-accent/50")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "warning" && "text-amber-700", tone === "danger" && "text-red-700")}>{formatNumber(value)}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
