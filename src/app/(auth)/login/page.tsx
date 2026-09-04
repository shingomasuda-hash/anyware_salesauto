import { redirect } from "next/navigation";
import { getEnv, hasNeonAuthConfig, isAuthDisabled } from "@/lib/config/env";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "ログイン" };

function missingConfig(): string[] {
  const env = getEnv();
  const items: string[] = [];
  if (!env.NEON_AUTH_BASE_URL) items.push("NEON_AUTH_BASE_URL が未設定です（Neon Console → Auth → Configuration の Base URL）");
  else if (!/^https?:\/\//.test(env.NEON_AUTH_BASE_URL)) items.push("NEON_AUTH_BASE_URL が URL の形式ではありません（https:// から始まる必要があります）");
  if (!env.NEON_AUTH_COOKIE_SECRET) items.push("NEON_AUTH_COOKIE_SECRET が未設定です");
  else if (env.NEON_AUTH_COOKIE_SECRET.length < 32) items.push(`NEON_AUTH_COOKIE_SECRET が短すぎます（現在 ${env.NEON_AUTH_COOKIE_SECRET.length} 文字、32文字以上が必要）`);
  if (items.length === 0) items.push("設定は揃っています。再デプロイ後にもう一度お試しください");
  return items;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; redirect?: string }> }) {
  if (isAuthDisabled()) redirect("/");
  const sp = await searchParams;
  const next = sp.next ?? sp.redirect ?? "/";
  const configured = hasNeonAuthConfig();
  if (configured && (await getCurrentUser())) redirect(next.startsWith("/") ? next : "/");
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-background p-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold">AnyWare Sales AI</h1>
          <p className="mt-1 text-sm text-muted-foreground">管理画面にログイン</p>
        </div>
        {configured ? (
          <LoginForm next={next} />
        ) : (
          <div className="space-y-2 text-sm text-red-700">
            <p>Neon Auth の設定が不足しています。環境変数（Vercel: Settings → Environment Variables / ローカル: .env.local）を確認し、設定後に再デプロイしてください。</p>
            <ul className="list-disc space-y-1 pl-5">
              {missingConfig().map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
