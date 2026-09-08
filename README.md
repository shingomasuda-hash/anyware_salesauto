# AnyWare Sales AI — AI営業リスト自動生成・企業分析システム

株式会社AnyWare 向けの「汎用営業AI基盤」。
条件を指定して営業対象企業を自動収集し、公式Webサイトを解析、Claude で企業のデジタル・採用・営業上の状態を客観分析してスコアリングし、営業リストとして蓄積します。

本リポジトリは **Phase 1〜3（企業収集 / HP解析・AI分析 / 管理画面）** を実装したものです。
Phase 4 以降（サービス登録・AIマッチング・営業メール生成・Gmail送信・返信管理・追客）は未実装ですが、DB 設計は先行して用意しています。

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [技術構成](#2-技術構成)
3. [ディレクトリ構成](#3-ディレクトリ構成)
4. [ローカル起動方法](#4-ローカル起動方法)
5. [Neon 設定方法](#5-neon-設定方法非エンジニア向け手順)
6. [Claude API 設定](#6-claude-api-設定)
7. [GビズINFO API 設定](#7-gビズinfo-api-設定)
8. [Google API 設定](#8-google-api-設定)
9. [環境変数一覧](#9-環境変数一覧)
10. [DB migration 方法](#10-db-migration-方法)
11. [DB 構成](#11-db-構成)
12. [処理フローとジョブキュー](#12-処理フローとジョブキュー)
13. [モックモードと実データの切り替え](#13-モックモードと実データの切り替え)
14. [テスト / Lint / ビルド](#14-テスト--lint--ビルド)
15. [Vercel デプロイ方法](#15-vercel-デプロイ方法)
16. [トラブルシューティング](#16-トラブルシューティング)
17. [未実装機能と次フェーズ](#17-未実装機能と次フェーズ)

---

## 1. プロジェクト概要

管理画面から「大阪府 / 製造業 / 100社」のように条件を指定すると、以下が自動で進みます。

```
企業候補取得（GビズINFO） → 重複排除 → 公式HP特定（ルールベース信頼度0-100）
  → Webサイトクロール（最大20ページ / robots.txt 尊重）
  → 問い合わせ先・SNS・営業拒否表記の抽出
  → Claude による企業分析（事実と推測を分離 / 構造化JSON）
  → スコアリング・営業ランク（A/B/C/D）判定 → 企業DBへ保存
  → 一覧で検索・絞り込み → 詳細で分析根拠（Evidence URL）を確認 → CSV出力
```

設計思想:

- **企業情報 / 企業分析 / 営業情報 / サービス情報を分離**（`companies` / `company_analysis` / `suppression_list` 等 / `services`）
- **データ基盤は Neon PostgreSQL + Drizzle ORM**、認証は **Neon Auth**（Supabase から移行済み）
- 採用支援を売るためだけのシステムにせず、**企業 × サービス** の将来マッチングを前提とした汎用基盤
- **hallucination 防止**: Web上で確認できた事実（`observed_facts`）と AI の推測（`inferences`）を分離保存、不明値は `null` / `unknown`、Evidence は実際にクロールした URL のみ保存
- **営業拒否表記の検出**: ルールベース + AI。検出企業は `sales_contact_allowed = 'false'` となり `suppression_list` に自動登録され、将来の自動送信から必ず除外できる
- **メールアドレスの推測生成は禁止**（サイト上の公開情報のみ）

## 2. 技術構成

| 領域 | 採用技術 |
| --- | --- |
| Frontend / Backend | Next.js 16 (App Router, Turbopack), TypeScript, React 19 |
| UI | Tailwind CSS v4, shadcn/ui 相当のコンポーネント（Radix UI + CVA。`src/components/ui`） |
| Database | Neon PostgreSQL（`@neondatabase/serverless` HTTP ドライバ + Drizzle ORM / drizzle-kit） |
| Auth | Neon Auth（`@neondatabase/auth`、Better Auth ベース。メール + パスワード） |
| AI | Anthropic Claude API（`@anthropic-ai/sdk`、構造化出力 + Zod 検証、Prompt Caching） |
| 企業情報 | GビズINFO REST API、公開企業サイト、Google Places API (New)（任意） |
| クローラー | fetch + cheerio + robots-parser + iconv-lite（Shift_JIS / EUC-JP 対応） |
| バリデーション | Zod v4 |
| テスト | Vitest |
| Hosting | Vercel（Cron Jobs 対応） |
| ローカルDB（任意） | 通常の PostgreSQL（`pg` ドライバに自動切替。テスト用） |

## 3. ディレクトリ構成

```
.
├── drizzle/
│   ├── 0000_init.sql               # 全テーブル / インデックス / FK（drizzle-kit generate で生成）
│   ├── 0001_functions.sql          # ビュー / claim_job 等の PostgreSQL 関数 / トリガー（custom migration）
│   └── meta/                       # drizzle-kit のスナップショット・ジャーナル
├── drizzle.config.ts               # drizzle-kit 設定（DATABASE_URL を .env.local から読む）
├── scripts/
│   ├── seed.ts                     # 開発用ユーザー作成 + モック検索の実行
│   └── run-jobs.ts                 # ローカル用ジョブランナー（Cron の代替）
├── src/
│   ├── app/
│   │   ├── (auth)/login/           # ログイン
│   │   ├── (app)/                  # 認証必須の管理画面
│   │   │   ├── page.tsx            # ダッシュボード
│   │   │   ├── companies/          # 企業一覧 / 詳細 / 手動追加
│   │   │   ├── search/             # 企業を探す / 検索進捗
│   │   │   ├── jobs/               # ジョブ状況・失敗再実行
│   │   │   ├── logs/               # システムログ / AI API 使用量
│   │   │   └── actions.ts          # Server Actions（検索開始・手動追加・再解析 等）
│   │   └── api/
│   │       ├── auth/[...path]/     # Neon Auth プロキシハンドラ
│   │       ├── jobs/process/       # ジョブ処理エンドポイント（ユーザー or JOB_SECRET）
│   │       ├── cron/process-jobs/  # Vercel Cron 用（CRON_SECRET）
│   │       ├── search-jobs/[id]/   # 検索進捗 JSON
│   │       └── companies/export/   # CSV エクスポート
│   ├── components/
│   │   ├── ui/                     # Button / Input / Table / Badge / Dialog ... (shadcn 互換)
│   │   ├── layout/                 # サイドバー / ページヘッダー / モードバナー
│   │   ├── companies/              # 企業テーブル / フィルタ / バッジ / 詳細セクション
│   │   ├── search/                 # 検索進捗（ポーリング）
│   │   └── jobs/, dashboard/
│   ├── db/                         # データアクセス層（Drizzle）
│   │   ├── schema.ts               # Drizzle スキーマ（全テーブル + company_overview ビュー）
│   │   ├── index.ts                # getDb()（Neon HTTP / ローカル pg の自動切替）
│   │   ├── types.ts                # Row 型（旧 Database 型と同名で公開）
│   │   ├── errors.ts               # PostgreSQL エラーコード判定
│   │   └── repositories/           # companies / pages / analysis / jobs / logs / suppression
│   ├── lib/
│   │   ├── config/                 # env.ts（Zod で環境変数検証）/ ai.ts / crawler.ts
│   │   ├── auth/                   # Neon Auth: server.ts（createNeonAuth）/ session.ts（getCurrentUser / requireUser）
│   │   ├── companies/              # normalize / dedupe / official-site / register / filters / csv / queries
│   │   ├── integrations/
│   │   │   ├── gbiz/               # GビズINFO クライアント + モック + マッピング
│   │   │   ├── google-places/      # Places API クライアント + モック
│   │   │   └── http/               # フェッチャー（文字コード判定）+ モックサイト生成
│   │   ├── crawler/                # robots / extract / classify / contacts / sales-restriction / crawl-site
│   │   ├── ai/                     # provider 抽象 / anthropic / mock / schemas / prompts / context / analyze-company
│   │   ├── scoring/                # 営業優先度スコア・ランク（決定論的）
│   │   ├── jobs/                   # runner / search-job / crawl-job / analysis-job / enqueue / status / kick
│   │   ├── logging/                # Logger（console + system_logs）
│   │   └── api/                    # API 認可
│   └── proxy.ts                    # Neon Auth middleware による未ログインリダイレクト（旧 middleware）
├── .env.example
├── vercel.json                     # Cron 設定
└── vitest.config.ts
```

## 4. ローカル起動方法

### 前提

- Node.js 20 以上（開発時は 22 で確認）
- Neon プロジェクト（database: `neondb`）。ローカル PostgreSQL でも動作します（後述）

### 手順

```bash
# 1. 依存関係
npm install

# 2. 環境変数
cp .env.example .env.local
#    → DATABASE_URL（Neon の接続文字列）、NEON_AUTH_BASE_URL、NEON_AUTH_COOKIE_SECRET を設定
#    → API キー未取得のうちは DATA_MODE=mock のままで OK

# 3. DB マイグレーション（詳細は「10. DB migration 方法」）
npm run db:migrate

# 4. ログインユーザー作成（Neon Console > Auth > Users）。開発中は AUTH_MODE=disabled でも可

# 5. （任意）モックで「大阪府 / 製造業 / 20社」を収集・分析してデータを用意
npm run seed

# 6. 起動
npm run dev                   # http://localhost:3000
```

ローカルには Vercel Cron がないため、バックグラウンド処理は次のいずれかで進みます。

- 検索進捗画面を開いている間、自動で `/api/jobs/process` を定期的に呼び出す（標準動作）
- ジョブ画面の「今すぐ処理を実行」ボタン
- 別ターミナルで `npm run jobs:run`（5秒間隔で常駐処理）

> 開発中に認証を省略したい場合は `.env.local` に `AUTH_MODE=disabled` を設定してください（`NODE_ENV=production` では無視され、必ず認証が有効になります）。

## 5. Neon 設定方法（非エンジニア向け手順）

### 5-1. Neon プロジェクトの作成

1. https://neon.com にサインアップし、**New Project** を押します
2. Project name は任意（例: `anyware-sales-ai`）、Database name は **`neondb`**、Region は **Asia Pacific (Singapore)** など日本に近いリージョンを選び **Create project**

### 5-2. DATABASE_URL の取得

1. Neon Console のプロジェクト画面右上 **Connect** を押します
2. Database が `neondb`、Role が `neondb_owner` になっていることを確認
3. **Connection string** をコピーします（`postgresql://neondb_owner:xxxx@ep-xxxx-pooler.….neon.tech/neondb?sslmode=require` の形式）
4. `.env.local` の `DATABASE_URL=` の右側に貼り付けます
   - この文字列にはパスワードが含まれます。**コードや Git、チャットに貼らない**でください
   - `NEXT_PUBLIC_` を付けてはいけません（ブラウザに露出します）

### 5-3. Neon Auth の有効化

1. Neon Console 左メニューの **Auth** を開き **Enable Neon Auth** を押します
2. 表示される **Base URL**（`https://ep-xxxx.neonauth.….neon.tech/neondb/auth` の形式）をコピーし、`.env.local` の `NEON_AUTH_BASE_URL=` に貼り付けます
3. **Email / Password** サインインが有効になっていることを確認します（既定で有効）
4. ログイン用ユーザーは、プロジェクトフォルダで次のコマンドを実行して作成します（Console の「Create user」はパスワードを設定できないため）
   ```bash
   npm run auth:create-user -- --email you@any-ware.jp --password "パスワード" --name "氏名"
   ```
   このシステムにはサインアップ画面がなく、`/api/auth` 経由のサインアップも遮断しています。利用者を増やすときも同じコマンドで作成してください
5. `NEON_AUTH_COOKIE_SECRET` には 32 文字以上のランダム文字列を設定します。ターミナルで次を実行した結果を貼り付けてください
   ```bash
   openssl rand -base64 32
   ```

### 5-4. .env.local の最小構成

```
DATABASE_URL=postgresql://neondb_owner:xxxx@ep-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
NEON_AUTH_BASE_URL=https://ep-xxxx.neonauth.ap-southeast-1.aws.neon.tech/neondb/auth
NEON_AUTH_COOKIE_SECRET=（openssl rand -base64 32 の結果）
DATA_MODE=mock            # APIキー設定後は live
ANTHROPIC_API_KEY=
GBIZ_API_KEY=
CRON_SECRET=（任意のランダム文字列）
JOB_SECRET=（任意のランダム文字列）
APP_URL=http://localhost:3000
```

### 5-5. テーブル作成（Drizzle migration）

```bash
npm install
npm run db:migrate
```

`drizzle/` にあるマイグレーション（テーブル・インデックス・ビュー・ジョブ取得関数）が Neon に適用されます。
Neon Console の **Tables** で `companies` などが見えれば成功です。

### 5-6. 認証の仕組み

- 画面アクセスは `src/proxy.ts` の Neon Auth middleware で保護され、未ログインは `/login` へリダイレクトされます
- Server Action / Route Handler は `requireUser()` / `getCurrentUser()`（`src/lib/auth/session.ts`）でセッションを検証します
- `/api/jobs/process` と `/api/cron/process-jobs` はログインユーザーまたは `JOB_SECRET` / `CRON_SECRET` の Bearer トークンでのみ実行できます
- DB は常にサーバー側から `DATABASE_URL` で接続します（ブラウザから DB へは接続しません）。単一企業の内部ツールのため PostgreSQL RLS は使用せず、アプリ層の認証で保護するシンプルな構成です

## 6. Claude API 設定

1. https://console.anthropic.com/ で API キーを発行
2. `.env.local`
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-opus-5        # モデル名はコードに直書きせずここで変更
   ANTHROPIC_MAX_OUTPUT_TOKENS=8000
   ANTHROPIC_EFFORT=medium              # low / medium / high
   DATA_MODE=live
   ```

実装上のポイント（`src/lib/ai/`）:

- `client.messages.parse` + `output_config.format`（Zod → JSON Schema）で **必ず構造化 JSON** を受け取る
- スキーマ違反 / 不正 JSON の場合はエラー内容を添えて最大 `maxParseRetries`（既定 2）回再試行
- 固定のシステムプロンプトに `cache_control` を付与し Prompt Caching を有効化
- 1 社あたり Claude に渡す本文は `maxContextChars`（既定 24,000 文字）以内。ページ種別ごとに文字数予算を設け、TOP 全文を毎回送らない
- 使用トークンは `ai_usage_logs` に記録（ログ画面「AI API 使用量」タブ）

## 7. GビズINFO API 設定

1. https://info.gbiz.go.jp/ → 「API利用申請」からトークンを取得（無料・即時〜数日）
2. `.env.local` に `GBIZ_API_KEY=<トークン>`、`DATA_MODE=live`

利用 API: `GET https://info.gbiz.go.jp/hojin/v1/hojin`（ヘッダ `X-hojinInfo-api-token`）、詳細は `/hojin/v1/hojin/{法人番号}`。

- API 側で絞れる条件: 都道府県コード、法人名キーワード、従業員数、法人種別
- API で絞れない条件（業種 / 市区町村）は取得後にローカルで判定（`src/lib/integrations/gbiz/mapping.ts`）
- 検索結果に `company_url` が無い法人のみ詳細 API を呼び、API 呼び出し数を抑制

## 8. Google API 設定

任意です。公式サイト URL が GビズINFO に無い企業の **公式サイト候補探索** にのみ使用します。

1. Google Cloud Console で **Places API (New)** を有効化し API キーを発行
2. `.env.local` に `GOOGLE_MAPS_API_KEY=...`

未設定の場合は候補探索をスキップし、企業は「HPなし / 要確認」として登録されます（詳細画面から手動で URL を設定可能）。

## 9. 環境変数一覧

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Neon の接続文字列（サーバー専用。`NEXT_PUBLIC_` 禁止） |
| `NEON_AUTH_BASE_URL` | ✅（認証使用時） | Neon Auth の Base URL |
| `NEON_AUTH_COOKIE_SECRET` | ✅（認証使用時） | セッション Cookie 署名鍵（32文字以上） |
| `APP_URL` | 推奨 | 公開URL（例: `https://xxx.vercel.app`） |
| `DATA_MODE` | - | `live` / `mock`。未設定時は development=mock、production=live |
| `AUTH_MODE` | - | `neon`（既定） / `disabled`（development 限定） |
| `DB_DRIVER` | - | `neon` を指定すると Neon 以外のホストでも HTTP ドライバを強制。通常は未設定（ホスト名で自動判定） |
| `ANTHROPIC_API_KEY` | live時 | Claude API キー |
| `ANTHROPIC_MODEL` | - | 既定 `claude-opus-5` |
| `ANTHROPIC_MAX_OUTPUT_TOKENS` | - | 既定 8000 |
| `ANTHROPIC_EFFORT` | - | `low` / `medium`（既定） / `high` |
| `GBIZ_API_KEY` | live時 | GビズINFO API トークン |
| `GOOGLE_MAPS_API_KEY` | - | Google Places API キー（任意） |
| `CRON_SECRET` | Vercel | Vercel Cron が付与する Bearer トークン（Vercel 側で同名の環境変数を設定） |
| `JOB_SECRET` | 推奨 | `/api/jobs/process` を外部から叩くための Bearer トークン |
| `JOB_MAX_RUNTIME_MS` | - | 1回のジョブ処理の最大時間（既定 50000。Vercel の maxDuration 未満に） |
| `CRAWL_MAX_PAGES` | - | 1社あたり最大クロールページ数（既定 20） |
| `CRAWL_DELAY_MS` | - | リクエスト間隔（既定 1000ms。robots.txt の Crawl-delay があればそちらを優先） |
| `CRAWL_TIMEOUT_MS` | - | 1ページのタイムアウト（既定 15000） |
| `CRAWL_USER_AGENT` | - | クローラーの User-Agent |

## 10. DB migration 方法

マイグレーションは **Drizzle ORM / drizzle-kit** で管理します（`drizzle/*.sql` + `drizzle/meta/`）。

| コマンド | 内容 |
| --- | --- |
| `npm run db:migrate` | `drizzle/` の未適用マイグレーションを `DATABASE_URL` の DB に適用 |
| `npm run db:generate` | `src/db/schema.ts` の変更から SQL マイグレーションを生成 |
| `npm run db:generate -- --custom --name xxx` | 関数・ビュー等を手書きする空のマイグレーションを作成 |
| `npm run db:check` | マイグレーションの整合性チェック |
| `npm run db:studio` | Drizzle Studio（ブラウザで DB を閲覧） |

**スキーマ変更の流れ**: `src/db/schema.ts` を編集 → `npm run db:generate` → 生成された SQL を確認 → `npm run db:migrate`。
ビューや PostgreSQL 関数を変更する場合は `--custom` で空ファイルを作り SQL を記述します（`drizzle/0001_functions.sql` 参照）。

**ローカル PostgreSQL で動かす場合**: `DATABASE_URL=postgres://user:pass@127.0.0.1:5432/anyware` のように Neon 以外のホストを指定すると、自動的に `pg` ドライバに切り替わります（マイグレーション・アプリとも同じ手順）。

## 11. DB 構成

| テーブル | 役割 |
| --- | --- |
| `companies` | 企業マスタ。法人番号 / ドメイン / 企業名+所在地 に部分ユニークインデックスで重複防止。連絡先・SNS・公式サイト信頼度・`sales_contact_allowed`・`sales_restriction_text` 等。`created_by` は Neon Auth のユーザーID（text） |
| `company_pages` | クロール済みページ（本文テキストのみ。raw HTML は保存しない） |
| `company_analysis` | AI 分析結果（各スコア・ランク・課題・強み・事実/推測・分析理由・信頼度・トークン数）。履歴として複数行保持し `companies.latest_analysis_id` が最新を指す |
| `company_analysis_evidence` | 分析根拠（カテゴリ / URL / 引用テキスト） |
| `search_jobs` / `search_job_items` | 企業検索ジョブと検出企業（new / duplicate / skipped / failed） |
| `crawl_jobs` / `analysis_jobs` | クロール / 分析ジョブ（pending / processing / completed / failed / retrying / cancelled、試行回数、エラー） |
| `system_logs` | 検索・登録・クロール・分析・API・エラーのログ |
| `ai_usage_logs` | Claude API のトークン使用量 |
| `suppression_list` | 営業拒否 / 配信停止 / 送信禁止 / 返信不要 の抑止リスト（企業・メール・ドメイン単位） |
| `services`, `campaigns`, `email_templates`, `email_messages`, `email_replies`, `contacts`, `activities` | Phase 4 以降用（空でも動作） |
| ビュー `company_overview` | 企業 + 最新分析をフラット化（一覧・CSV・ダッシュボード用） |
| 関数 `claim_job` | `FOR UPDATE SKIP LOCKED` でジョブを取得し、同時実行時の二重処理を防止。stale な processing を自動復旧（Drizzle から `select claim_job(...)` で呼び出し） |
| 関数 `increment_search_job_counters`, `dashboard_stats` | カウンタのアトミック加算 / ダッシュボード集計 |
| トリガー `set_updated_at` | `updated_at` の自動更新 |

## 12. 処理フローとジョブキュー

1 リクエストで 100 社を同期処理せず、すべてジョブとして分割します。

```
[企業を探す] → search_jobs 作成 → after() で即時処理開始
   ├ search step: GビズINFO をページ単位で取得 → 条件判定 → 重複判定 → 登録 → crawl_jobs 投入
   │              （時間切れなら cursor を保存して次回再開）
   ├ crawl job : 公式HP判定（閾値 60 未満は "要確認" にして保存しない）→ クロール → 連絡先/SNS/営業拒否抽出 → analysis_jobs 投入
   └ analysis  : コンテキスト構築 → Claude → Zod 検証 → スコアリング → 保存 → suppression_list 更新
```

ジョブランナー（`src/lib/jobs/runner.ts`）は次の 3 経路で起動します。

| 経路 | 用途 |
| --- | --- |
| `after()`（Server Action 直後） | 検索開始・手動追加・再解析の直後に即時処理 |
| 検索進捗画面のポーリング → `POST /api/jobs/process` | 画面を開いている間は処理が進む |
| Vercel Cron → `GET /api/cron/process-jobs`（毎分） | 画面を閉じても処理が進む（`vercel.json`） |

失敗ジョブは `max_attempts`（3回）まで自動再試行し、超えると `failed`。ジョブ画面 / 検索進捗画面から **失敗した企業のみ再実行** できます。

## 13. モックモードと実データの切り替え

`DATA_MODE=mock` では次がモックに置き換わります（本番コードとモックは Provider インターフェースで分離）。

| 対象 | 実装 | モック |
| --- | --- | --- |
| GビズINFO | `integrations/gbiz/client.ts` | `integrations/gbiz/mock.ts`（決定論的なダミー法人 180 社） |
| Google Places | `integrations/google-places/index.ts` | 同ファイル内 `MockPlacesProvider` |
| Claude | `ai/anthropic.ts` | `ai/mock.ts`（クロール結果からヒューリスティックに分析） |
| Web サイト | 実 HTTP | `mock-*.example.jp` ドメインのみ合成 HTML（`integrations/http/mock-site.ts`） |

クローラー自体は API キー不要のため、モックモードでも実在サイトの URL を手動追加すれば実クロールされます（AI 分析はモック）。
画面上部に黄色いバナーでモード（mock / 認証無効）を常時表示します。

## 14. テスト / Lint / ビルド

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest（重複判定 / URL正規化 / ドメイン取得 / メール抽出 / 営業拒否判定 / AIスキーマ / スコア計算 / クローラー）
npm run build       # next build
```

## 15. Vercel デプロイ方法

1. GitHub リポジトリを Vercel にインポート（Framework: Next.js）
2. **Environment Variables** に「9. 環境変数一覧」の値を設定（Neon Console の **Integrations > Vercel** を使うと `DATABASE_URL` 等を自動で同期できます）
   - `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`
   - `DATA_MODE=live`, `AUTH_MODE=neon`
   - `CRON_SECRET` に長いランダム文字列を設定（Vercel Cron はこの値を `Authorization: Bearer` で送信）
   - `JOB_SECRET` も設定（外部スケジューラから叩く場合）
3. デプロイ。`vercel.json` の Cron（毎日 03:00 JST に `/api/cron/process-jobs`）が自動登録されます
   - Hobby プランは Cron が 1日1回までのため既定は日次にしています。Pro プランなら `vercel.json` の schedule を `* * * * *`（毎分）に変更すると画面を閉じていても処理が進みます
   - 日次のままでも、検索進捗画面を開いている間はポーリングで処理が進みます。外部スケジューラ（例: cron-job.org から `POST /api/jobs/process` に `Authorization: Bearer <JOB_SECRET>`）で補うこともできます
4. `APP_URL` を本番 URL に設定
5. 関数実行時間: Route Handler は `maxDuration = 300` を指定済み。Hobby プランでは最大 60 秒のため `JOB_MAX_RUNTIME_MS=45000` 程度に下げてください

## 16. トラブルシューティング

| 症状 | 原因 / 対処 |
| --- | --- |
| `環境変数 XXX が設定されていません` | `.env.local` または Vercel の環境変数を確認。`DATA_MODE=mock` なら GBIZ / ANTHROPIC キーは不要 |
| ログインできない | Neon Console > Auth > Users でユーザーを作成しているか。`NEON_AUTH_BASE_URL` が正しいか |
| `/login` にリダイレクトされ続ける | `NEON_AUTH_COOKIE_SECRET` が 32 文字以上か。ブラウザの Cookie を削除して再ログイン |
| `DATABASE_URL が設定されていません` | `.env.local` / Vercel に Neon の接続文字列を設定。`npm run db:migrate` を実行済みか |
| `relation "companies" does not exist` | マイグレーション未適用。`npm run db:migrate` |
| 検索を開始しても進まない | ジョブ画面の「今すぐ処理を実行」か `npm run jobs:run` を実行。Vercel では Cron / `CRON_SECRET` を確認。ログ画面の `error` を確認 |
| 企業が「要確認」になる | 公式サイト信頼度が閾値（60）未満。詳細画面で候補を確認し「公式に設定」 |
| 企業が「HPなし」になる | GビズINFO に URL が無く Google Places も未設定/該当なし。詳細画面で手入力 |
| AI分析が `failed` | ログ画面の `analysis` エラーを確認。`ANTHROPIC_API_KEY` / モデル名 / レート制限。失敗ジョブは再実行可能 |
| GビズINFO で 429 | レート制限。時間を置いて失敗ジョブを再実行 |
| クロールが `robots.txt によりクロール不可` | 対象サイトがクロール禁止。手動でサイト内容を確認する運用に |
| 文字化け | Shift_JIS / EUC-JP は自動判定。`content-type` / `<meta charset>` が無いサイトは UTF-8 として処理 |
| CSV が Excel で文字化け | UTF-8 BOM 付きで出力済み。Excel で開けない場合は「データ > テキストから」で UTF-8 を指定 |
| Neon の接続数エラー | 本番は `@neondatabase/serverless` の HTTP ドライバ（接続を保持しない）を使用。`-pooler` 付きの接続文字列を推奨 |

## 17. 未実装機能と次フェーズ

**今回実装していないもの（意図的に除外）**

- 営業メール自動生成・送信（Gmail API）、問い合わせフォーム自動送信、AI返信、追客、営業サービス提案生成
- サービス（`services`）の登録 UI と企業 × サービスのマッチング
- 商談化率 / 返信率の分析ダッシュボード
- 検索条件「採用活動の有無」の事前絞り込み（分析後に一覧フィルタで対応）
- 企業情報の手動編集フォーム（連絡可否・公式サイトの手動設定のみ対応）

**次フェーズで実装すべき内容（DB は準備済み）**

1. `services` 登録画面と `company_analysis.recommended_topics` × `services.target_issues` の AI マッチング
2. `email_templates` / `campaigns` と企業ごとの営業メール AI 生成（`suppression_list` と `sales_contact_allowed='false'` を必ず除外）
3. Gmail API 送信（`email_messages`）と返信取り込み（`email_replies`）、未返信企業の追客スケジュール
4. `contacts` の担当者抽出（代表者・採用担当など）
5. 定期再クロール（`last_crawled_at` ベース）と分析差分の通知
6. 商談化率 / 返信率の集計（`activities`）
