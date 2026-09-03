"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setOfficialSiteAction } from "@/app/(app)/actions";

export interface SiteCandidate {
  url: string;
  source?: string;
  confidence?: number;
  reasons?: string[];
  title?: string | null;
}

/** 公式サイトが要確認 / 未設定の企業に対し、候補から選択 or 手入力で確定する */
export function OfficialSiteForm({ companyId, candidates }: { companyId: string; candidates: SiteCandidate[] }) {
  const [url, setUrl] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = (target: string) =>
    start(async () => {
      const res = await setOfficialSiteAction(companyId, target);
      if (res?.ok) toast.success(res.message);
      else toast.error(res?.message ?? "失敗しました");
      router.refresh();
    });

  return (
    <div className="space-y-3">
      {candidates.length > 0 ? (
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.url} className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="break-all font-medium hover:underline">
                  {c.url}
                </a>
                <div className="text-xs text-muted-foreground">
                  {c.title ? `${c.title} · ` : ""}
                  信頼度 {c.confidence ?? "—"} · {c.source ?? "—"}
                  {c.reasons && c.reasons.length > 0 ? ` · ${c.reasons.join(" / ")}` : ""}
                </div>
              </div>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => submit(c.url)}>
                公式に設定
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) submit(url.trim());
        }}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.co.jp" className="max-w-md" />
        <Button type="submit" size="sm" disabled={pending || !url.trim()}>
          手入力で設定
        </Button>
      </form>
    </div>
  );
}
