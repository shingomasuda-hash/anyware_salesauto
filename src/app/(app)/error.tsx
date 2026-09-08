"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-lg font-semibold">エラーが発生しました</p>
      <p className="max-w-lg text-sm text-muted-foreground">
        サーバー側の処理でエラーが発生しました。設定の状態は <a href="/api/health" className="underline">/api/health</a> で確認できます。
        {error.digest ? ` (digest: ${error.digest})` : ""}
      </p>
      <Button onClick={reset}>再試行</Button>
    </div>
  );
}
