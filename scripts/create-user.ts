/**
 * Neon Auth にメール + パスワードのユーザーを作成する管理用スクリプト。
 * Neon Console の「Create user」はパスワードを設定できないため、ログイン用ユーザーはこのコマンドで作る。
 *
 *   npm run auth:create-user -- --email you@example.com --password "yourpassword" --name "Your Name"
 *
 * NEON_AUTH_BASE_URL は .env.local から読み込む。アプリ側の /api/auth ではサインアップを遮断しているため、
 * このスクリプトは Neon Auth のエンドポイントへ直接リクエストする。
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL?.replace(/\/+$/, "");
  const email = arg("email");
  const password = arg("password");
  const name = arg("name") ?? email?.split("@")[0] ?? "user";
  if (!baseUrl) throw new Error("NEON_AUTH_BASE_URL が .env.local に設定されていません");
  if (!email || !password) throw new Error('使い方: npm run auth:create-user -- --email you@example.com --password "yourpassword" [--name "Your Name"]');
  if (password.length < 8) throw new Error("パスワードは8文字以上にしてください");

  const res = await fetch(`${baseUrl}/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.APP_URL ?? "http://localhost:3000" },
    body: JSON.stringify({ email, password, name }),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* plain text */
  }
  if (!res.ok) {
    const msg = typeof body === "object" && body && "message" in body ? String((body as { message: unknown }).message) : text;
    if (/exist/i.test(msg)) {
      console.error(`このメールアドレスは既に登録されています: ${email}`);
      console.error("Neon Console > Auth > Users で該当ユーザーを Delete user してから再実行してください。");
    } else {
      console.error(`作成に失敗しました (HTTP ${res.status}): ${msg}`);
    }
    process.exit(1);
  }
  console.log(`ユーザーを作成しました: ${email}`);
  console.log("ログイン画面でこのメールアドレスとパスワードを入力してください。");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
