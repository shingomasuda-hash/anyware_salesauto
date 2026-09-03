import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-lg font-semibold">ページが見つかりません</p>
      <Button asChild variant="outline">
        <Link href="/">ダッシュボードへ</Link>
      </Button>
    </div>
  );
}
