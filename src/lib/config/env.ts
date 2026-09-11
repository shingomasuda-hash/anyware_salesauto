import { z } from "zod";

/**
 * 環境変数の一元管理。
 * - サーバー専用の値（DATABASE_URL / NEON_AUTH_COOKIE_SECRET / 各APIキー）はここからしか読まない
 *   （NEXT_PUBLIC_ を付けないためブラウザ bundle に含まれない）
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
  AUTH_MODE: z.enum(["neon", "disabled"]).optional(),

  DATABASE_URL: optionalString,
  DB_DRIVER: z.enum(["neon", "pg"]).optional(),
  NEON_AUTH_BASE_URL: optionalString,
  NEON_AUTH_COOKIE_SECRET: optionalString,

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  ANTHROPIC_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8000),
  // 構造化抽出が中心の分析のため既定は low。判断の質を上げたい場合だけ medium / high に上げる。
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  /** 分析1回あたりに Claude へ渡す本文テキストの上限（文字）。入力トークン＝費用に直結する */
  ANTHROPIC_MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(10_000),

  // --- AI 費用のガード ---
  /** 当月の Claude API 費用の上限（円）。0 以下で上限なし */
  AI_MONTHLY_BUDGET_JPY: z.coerce.number().int().nonnegative().default(10_000),
  /** 費用表示・予算判定に使う為替レート（1 USD = N 円） */
  AI_USD_JPY_RATE: z.coerce.number().positive().default(155),
  /**
   * 採用・求人の痕跡がある企業だけ AI 分析する（費用の大半はここで決まる）。
   * 「採用ページがある企業だけ」ではない。公式サイトに採用ページが無い企業も
   * 求人媒体を使っていれば営業ターゲットになるため。
   */
  ANALYSIS_REQUIRE_RECRUIT_SIGNAL: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // --- 企業ごとの文面（取材依頼 / サービス提案） ---
  /** 何を依頼する文面か。既定は取材依頼 */
  SALES_OUTREACH_PURPOSE: z.enum(["interview", "proposal"]).default("interview"),
  /** 差出人 */
  SALES_SENDER_COMPANY: optionalString,
  SALES_SENDER_NAME: optionalString,
  /** 依頼したい次の行動（未設定なら目的ごとの既定文を使う） */
  SALES_OUTREACH_CTA: optionalString,
  /** 取材依頼: 何について取材したいか。未設定なら生成しない */
  SALES_INTERVIEW_TOPIC: optionalString,
  /** 取材依頼: 掲載先・媒体 */
  SALES_INTERVIEW_MEDIUM: optionalString,
  /** 取材依頼: 形式・所要時間 */
  SALES_INTERVIEW_FORMAT: optionalString,
  /** サービス提案: サービス名 */
  SALES_OFFERING_NAME: optionalString,
  /** サービス提案: 何を提供するか。未設定なら生成しない */
  SALES_OFFERING_SUMMARY: optionalString,
  /** サービス提案: 強み・提供できること（| 区切り） */
  SALES_OFFERING_STRENGTHS: optionalString,

  GBIZ_API_KEY: optionalString,
  GOOGLE_MAPS_API_KEY: optionalString,
  BRAVE_SEARCH_API_KEY: optionalString,
  EDINET_API_KEY: optionalString,

  // --- Multi-Source Discovery ---
  DISCOVERY_MODE: z.enum(["gbiz", "places", "search", "hybrid"]).optional(),
  DISCOVERY_MAX_PROVIDER_REQUESTS: z.coerce.number().int().positive().default(60),
  DISCOVERY_MAX_CANDIDATES: z.coerce.number().int().positive().default(600),
  DISCOVERY_MAX_VERIFICATION_REQUESTS: z.coerce.number().int().positive().default(300),
  DISCOVERY_MAX_AI_CALLS: z.coerce.number().int().positive().default(200),
  DISCOVERY_MAX_EXECUTION_MINUTES: z.coerce.number().int().positive().default(60),

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
  // Vercel 等で「値が空」の変数が登録されている場合は未設定として扱う
  const source: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string" && v.trim() !== "") source[k] = v.trim();
  }
  const parsed = envSchema.safeParse(source);
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

/** Neon Auth が設定済みか（未設定 + AUTH_MODE=disabled の開発モードを許容するため） */
export function hasNeonAuthConfig(): boolean {
  const env = getEnv();
  return Boolean(env.NEON_AUTH_BASE_URL && env.NEON_AUTH_COOKIE_SECRET && env.NEON_AUTH_COOKIE_SECRET.length >= 32);
}

export function hasDatabaseConfig(): boolean {
  return Boolean(getEnv().DATABASE_URL);
}
