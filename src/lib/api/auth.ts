import { getEnv } from "@/lib/config/env";
import { getCurrentUser } from "@/lib/supabase/auth";

/**
 * API ルートの認可: ログインユーザー、または Bearer トークン（JOB_SECRET / CRON_SECRET）。
 */
export async function authorizeApiRequest(
  request: Request,
  options: { allowSecrets?: ("JOB_SECRET" | "CRON_SECRET")[] } = {},
): Promise<{ ok: true; via: "user" | "secret" } | { ok: false; status: number; message: string }> {
  const env = getEnv();
  const auth = request.headers.get("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (bearer && options.allowSecrets) {
    for (const key of options.allowSecrets) {
      const secret = env[key];
      if (secret && bearer === secret) return { ok: true, via: "secret" };
    }
  }
  const user = await getCurrentUser();
  if (user) return { ok: true, via: "user" };
  return { ok: false, status: 401, message: "Unauthorized" };
}
