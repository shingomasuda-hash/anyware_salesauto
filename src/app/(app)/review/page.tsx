import { PageHeader } from "@/components/layout/page-header";
import { ReviewCard } from "@/components/discovery/review-card";
import { getDb } from "@/db";
import { listReviewQueue } from "@/db/repositories/discovery";

export const dynamic = "force-dynamic";
export const metadata = { title: "確認待ちリスト" };

export default async function ReviewPage() {
  const candidates = await listReviewQueue(getDb(), 100);
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="確認待ちリスト"
        description="通常は自動で判定するため、この一覧は空になります（公式サイトを確認できた候補は自動で追加し、確認できなかった候補は自動で見送ります）。人が確認する運用に戻すには DISCOVERY_AUTO_REVIEW=false を設定してください。"
      />
      {candidates.length === 0 ? (
        <div className="rounded-lg border py-16 text-center text-muted-foreground">確認待ちの候補はありません（自動で判定済みです）</div>
      ) : (
        <div className="space-y-4">
          {candidates.map((c) => (
            <ReviewCard key={c.id} candidate={c} runName={c.run_name} />
          ))}
        </div>
      )}
    </div>
  );
}
