"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/select";
import { analyzeOnlyAction, reanalyzeCompanyAction, setSalesContactAllowedAction } from "@/app/(app)/actions";
import type { SalesContactAllowed } from "@/lib/db/types";

export function ReanalyzeButton({ companyId, disabled }: { companyId: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      disabled={pending || disabled}
      onClick={() =>
        start(async () => {
          const res = await reanalyzeCompanyAction(companyId);
          if (res?.ok) toast.success(res.message);
          else toast.error(res?.message ?? "失敗しました");
          router.refresh();
        })
      }
    >
      <RefreshCw className={pending ? "animate-spin" : ""} /> 再解析
    </Button>
  );
}

export function AnalyzeOnlyButton({ companyId, disabled }: { companyId: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      disabled={pending || disabled}
      onClick={() =>
        start(async () => {
          const res = await analyzeOnlyAction(companyId);
          if (res?.ok) toast.success(res.message);
          else toast.error(res?.message ?? "失敗しました");
          router.refresh();
        })
      }
    >
      <Sparkles /> AI分析のみ
    </Button>
  );
}

export function SalesContactSelect({ companyId, value }: { companyId: string; value: SalesContactAllowed }) {
  const [current, setCurrent] = useState<SalesContactAllowed>(value);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <NativeSelect
      value={current}
      disabled={pending}
      className="h-8 w-40 text-xs"
      onChange={(e) => {
        const v = e.target.value as SalesContactAllowed;
        setCurrent(v);
        start(async () => {
          const res = await setSalesContactAllowedAction(companyId, v);
          if (res?.ok) toast.success(res.message);
          else toast.error(res?.message ?? "失敗しました");
          router.refresh();
        });
      }}
    >
      <option value="unknown">連絡可否: 不明</option>
      <option value="true">連絡可否: 可</option>
      <option value="false">連絡可否: 不可（営業拒否）</option>
    </NativeSelect>
  );
}
