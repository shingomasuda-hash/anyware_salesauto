"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { retryFailedJobsAction, runJobsNowAction } from "@/app/(app)/actions";

export function JobsToolbar({ failedCount }: { failedCount: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button
        variant="outline"
        disabled={pending || failedCount === 0}
        onClick={() =>
          start(async () => {
            const r = await retryFailedJobsAction({});
            if (r?.ok) toast.success(r.message);
            else toast.error(r?.message ?? "失敗");
            router.refresh();
          })
        }
      >
        <RotateCcw /> 失敗ジョブを再実行 ({failedCount})
      </Button>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runJobsNowAction();
            if (r?.ok) toast.success(r.message);
            else toast.error(r?.message ?? "失敗");
            router.refresh();
          })
        }
      >
        <Play /> {pending ? "処理中…" : "今すぐ処理を実行"}
      </Button>
    </>
  );
}
