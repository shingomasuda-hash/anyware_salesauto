import { z } from "zod";

/**
 * 環境変数の一元管理。
 * - サーバー専用の値はここからしか読まない（クライアントへの露出防止）
 * - 未設定でも開発が止まらないよう、必須チェックは "利用時" に行う（requireEnv）
 */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: optionalString,
  DATA_MODE: z.enum(["live", "mock"]).optional(),
  AUTH_MODE: z.enum(["supabase", "disabled"]).optional(),

  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  ANTHROPIC_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8000),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),

  GBIZ_API_KEY: optionalString,
  GOOGLE_MAPS_API_KEY: optionalString,

  JOB_SECRET: optionalString,
  CRON_SECRET: optionalString,
  JOB_MAX_RUNTIME_MS: z.coerce.number().int().positive().default(50_000),

  CRAWL_MAX_PAGES: z.coerce.number().int().positive().max(100).default(20),
  CRAWL_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
  CRAWL_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  CRAWL_USER_AGENT: z.string().default("AnyWareSalesBot/1.0 (+https://any-ware.jp)"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`環境変数が不正です: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`);
  }
  cached = parsed.data;
  return cached;
}

/** テスト用: キャッシュを破棄 */
export function resetEnvCache() {
  cached = null;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}

/**
 * 外部API（GビズINFO / Google / Claude）の接続モード。
 * 明示指定がなければ development では mock、production では live。
 */
export function getDataMode(): "live" | "mock" {
  const env = getEnv();
  if (env.DATA_MODE) return env.DATA_MODE;
  return env.NODE_ENV === "production" ? "live" : "mock";
}

export function isMockMode(): boolean {
  return getDataMode() === "mock";
}

/** 認証を無効化できるのは development / test のみ */
export function isAuthDisabled(): boolean {
  const env = getEnv();
  return env.AUTH_MODE === "disabled" && env.NODE_ENV !== "production";
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = getEnv()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`環境変数 ${key} が設定されていません。.env.local または Vercel の環境変数を確認してください。`);
  }
  return value as NonNullable<Env[K]>;
}

export function hasSupabaseConfig(): boolean {
  const env = getEnv();
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
