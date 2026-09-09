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
        description="自動判定では企業を断定できなかった候補です。内容を確認して承認すると営業候補企業として登録され、クロールとAI分析に進みます。承認するまでデータベースには登録されません。"
      />
      {candidates.length === 0 ? (
        <div className="rounded-lg border py-16 text-center text-muted-foreground">確認待ちの候補はありません</div>
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
