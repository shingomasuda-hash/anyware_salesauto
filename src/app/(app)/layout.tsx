import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db";
import { countPendingReview } from "@/db/repositories/discovery";
import { isAuthDisabled } from "@/lib/config/env";
import { SidebarNav } from "@/components/layout/sidebar";
import { ModeBanner } from "@/components/layout/mode-banner";
import { Button } from "@/components/ui/button";
import { signOutAction } from "./actions";

// 全管理画面はセッション（cookies）に依存するため常に動的レンダリング
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // 確認待ち候補の件数（承認するまで companies には入らないので、見落とさないよう常に表示する）
  const reviewCount = await countPendingReview(getDb()).catch(() => 0);
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 md:flex">
        <div className="mb-6 px-2">
          <div className="text-sm font-semibold tracking-tight">AnyWare Sales AI</div>
          <div className="text-xs text-muted-foreground">営業リスト自動生成</div>
        </div>
        <SidebarNav reviewCount={reviewCount} />
        <div className="mt-auto space-y-2 px-2 pt-6">
          <div className="truncate text-xs text-muted-foreground" title={user.email ?? ""}>
            {user.email ?? "—"}
          </div>
          {!isAuthDisabled() ? (
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm" className="h-7 w-full justify-start px-1 text-xs text-muted-foreground">
                <LogOut className="size-3.5" /> ログアウト
              </Button>
            </form>
          ) : null}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <ModeBanner />
        <header className="flex h-12 items-center gap-3 border-b px-4 md:hidden">
          <span className="text-sm font-semibold">AnyWare Sales AI</span>
        </header>
        <div className="border-b px-4 py-2 md:hidden">
          <SidebarNav reviewCount={reviewCount} />
        </div>
        <main className="flex-1 px-6 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
