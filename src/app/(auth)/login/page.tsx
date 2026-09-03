import { redirect } from "next/navigation";
import { hasSupabaseConfig, isAuthDisabled } from "@/lib/config/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "ログイン" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (isAuthDisabled()) redirect("/");
  const { next } = await searchParams;
  const configured = hasSupabaseConfig();
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-background p-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold">AnyWare Sales AI</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理画面にログイン</p>
        </div>
        {configured ? (
          <LoginForm next={next ?? "/"} />
        ) : (
          <p className="text-sm text-red-700">
            NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です。.env.local を確認してください。
            開発中は AUTH_MODE=disabled で認証をスキップできます。
          </p>
        )}
      </div>
    </div>
  );
}
