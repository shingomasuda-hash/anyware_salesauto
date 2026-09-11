# AnyWare Sales AI — AI営業リスト自動生成・企業分析システム

株式会社AnyWare 向けの「汎用営業AI基盤」。
条件を指定して営業対象企業を自動収集し、公式Webサイトを解析、Claude で企業のデジタル・採用・営業上の状態を客観分析してスコアリングし、営業リストとして蓄積します。

本リポジトリは **Phase 1〜3（企業収集 / HP解析・AI分析 / 管理画面）** と、
**複数情報源からの企業探索（Multi-Source Discovery）** を実装したものです。
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
8. [Google API 設定](#8-google-api-設定) / [Brave Search・EDINET](#8-5-brave-search--edinet-api-設定任意)
9. [環境変数一覧](#9-環境変数一覧)
10. [DB migration 方法](#10-db-migration-方法)
11. [DB 構成](#11-db-構成)
12. [処理フローとジョブキュー](#12-処理フローとジョブキュー)
12.5 [企業探索（Multi-Source Discovery）](#125-企業探索multi-source-discovery)
13. [モックモードと実データの切り替え](#13-モックモードと実データの切り替え)
14. [テスト / Lint / ビルド・実企業データ検証](#14-テスト--lint--ビルド)
15. [Vercel デプロイ方法](#15-vercel-デプロイ方法)
16. [トラブルシューティング](#16-トラブルシューティング)
17. [未実装機能と次フェーズ](#17-未実装機能と次フェーズ)

---

## 1. プロジェクト概要

管理画面から「大阪府 / 製造業 / 100社」のように条件を指定すると、以下が自動で進みます。

```
企業候補の発見（GビズINFO / Google Places / Web検索 / EDINET）
  → 情報統合（出所ごとの優先度で項目単位にマージ）
  → 本人確認（Verification Score 0-100） → 重複排除 → 公式HP確認
  → ここで初めて companies へ登録（確認できなかった候補は「確認待ち」に留める）
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
- **検索結果をそのまま企業DBに入れない**: 発見 → 本人確認 → 確認済 の順を必ず通し、確認できなかった候補は `discovery_candidates` に留めて人の承認を待つ
- **Source of Truth は GビズINFO**（法人番号・商号・所在地）。Web検索由来の値でそれを上書きしない

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
│   ├── 0002_discovery.sql          # discovery_runs / discovery_candidates / company_sources
│   ├── 0003_discovery_functions.sql # claim_job の discovery_runs 対応 / トリガー / dashboard_stats 更新
│   └── meta/                       # drizzle-kit のスナップショット・ジャーナル
├── drizzle.config.ts               # drizzle-kit 設定（DATABASE_URL を .env.local から読む）
├── scripts/
│   ├── seed.ts                     # 開発用ユーザー作成 + モック検索の実行
│   ├── run-jobs.ts                 # ローカル用ジョブランナー（Cron の代替）
│   ├── preflight.ts                # 実API接続の事前診断（キー・モデル・情報源の利用可否）
│   ├── discovery.ts                # 企業探索の実行 CLI（npm run discovery）
│   ├── discovery-review.ts         # 確認待ちリストの確認 / 承認 / 却下 CLI
│   ├── test-real.ts / verify.ts    # 実企業データ検証とレポート
│   └── create-user.ts              # ログインユーザー作成
├── src/
│   ├── app/
│   │   ├── (auth)/login/           # ログイン
│   │   ├── (app)/                  # 認証必須の管理画面
│   │   │   ├── page.tsx            # ダッシュボード
│   │   │   ├── companies/          # 企業一覧 / 詳細 / 手動追加
│   │   │   ├── search/             # 企業を探す（探索フォーム）/ 旧検索の進捗
│   │   │   ├── discovery/[id]/     # 探索の進捗（情報源ごとの内訳・候補一覧）
│   │   │   ├── review/             # 確認待ちリスト（承認 / 却下 / 公式HP修正）
│   │   │   ├── jobs/               # ジョブ状況・失敗再実行
│   │   │   ├── logs/               # システムログ / AI API 使用量
│   │   │   └── actions.ts          # Server Actions（検索開始・手動追加・再解析 等）
│   │   └── api/
│   │       ├── auth/[...path]/     # Neon Auth プロキシハンドラ
│   │       ├── jobs/process/       # ジョブ処理エンドポイント（ユーザー or JOB_SECRET）
│   │       ├── cron/process-jobs/  # Vercel Cron 用（CRON_SECRET）
│   │       ├── search-jobs/[id]/   # 検索進捗 JSON
│   │       ├── discovery-runs/[id]/ # 探索進捗 JSON
│   │       └── companies/export/   # CSV エクスポート
│   ├── components/
│   │   ├── ui/                     # Button / Input / Table / Badge / Dialog ... (shadcn 互換)
│   │   ├── layout/                 # サイドバー / ページヘッダー / モードバナー
│   │   ├── companies/              # 企業テーブル / フィルタ / バッジ / 詳細セクション
│   │   ├── search/                 # 検索進捗（ポーリング）
│   │   ├── discovery/              # 探索進捗（情報源ごとの内訳）/ 確認待ちカード
│   │   └── jobs/, dashboard/
│   ├── db/                         # データアクセス層（Drizzle）
│   │   ├── schema.ts               # Drizzle スキーマ（全テーブル + company_overview ビュー）
│   │   ├── index.ts                # getDb()（Neon HTTP / ローカル pg の自動切替）
│   │   ├── types.ts                # Row 型（旧 Database 型と同名で公開）
│   │   ├── errors.ts               # PostgreSQL エラーコード判定
│   │   └── repositories/           # companies / pages / analysis / jobs / logs / suppression / discovery
│   ├── lib/
│   │   ├── config/                 # env.ts（Zod で環境変数検証）/ ai.ts / crawler.ts / discovery.ts（重み・しきい値・予算）
│   │   ├── auth/                   # Neon Auth: server.ts（createNeonAuth）/ session.ts（getCurrentUser / requireUser）
│   │   ├── companies/              # normalize / dedupe / official-site / register / filters / csv / queries
│   │   ├── integrations/
│   │   │   ├── gbiz/               # GビズINFO クライアント + モック + マッピング
│   │   │   ├── google-places/      # Places API クライアント + モック
│   │   │   └── http/               # フェッチャー（文字コード判定）+ モックサイト生成
│   │   ├── discovery/              # 企業探索
│   │   │   ├── providers/          # gbiz / google-places / web-search / edinet / official-web + mock + registry
│   │   │   ├── query-generator.ts  # 業種を細分化した検索語の生成
│   │   │   ├── query-sharding.ts   # 市区町村 × 業種細分への分割
│   │   │   ├── query-planner.ts    # どの Provider に何を投げるかの計画
│   │   │   ├── aggregator.ts       # 実行・統合（Provider 単体の失敗を隔離）
│   │   │   ├── deduplicator.ts     # 重複判定と出所優先度によるマージ
│   │   │   ├── verifier.ts         # 本人確認スコア（0-100）
│   │   │   ├── promote.ts          # 確認済み候補 → companies への昇格
│   │   │   ├── review.ts           # 手動の承認 / 却下 / 公式HP修正
│   │   │   ├── budget.ts / retry.ts # API 予算管理・指数バックオフ
│   │   │   └── taxonomy.ts         # 業種の細分カテゴリ
│   │   ├── crawler/                # robots / extract / classify / contacts / sales-restriction / crawl-site
│   │   ├── ai/                     # provider 抽象 / anthropic / mock / schemas / prompts / context / analyze-company
│   │   ├── scoring/                # 営業優先度スコア・ランク（決定論的）
│   │   ├── jobs/                   # runner / discovery-job / search-job / crawl-job / analysis-job / enqueue / status / kick
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

任意です。**地域の企業の発見**（Google Places Provider）と、公式サイト URL が GビズINFO に無い企業の **公式サイト候補探索** に使用します。

1. Google Cloud Console で **Places API (New)** を有効化し API キーを発行
2. `.env.local` に `GOOGLE_MAPS_API_KEY=...`

未設定の場合は Places を使わずに探索を続行します（他の情報源だけで動作します）。
リクエストする項目は `id / displayName / formattedAddress / nationalPhoneNumber / websiteUri / primaryType` に限定しており、口コミ・写真等の課金項目は取得しません。

## 8-5. Brave Search / EDINET API 設定（任意）

どちらも未設定で構いません。設定すると探索の網羅性が上がります。

| API | 用途 | 取得先 | 環境変数 |
| --- | --- | --- | --- |
| Brave Search | Web検索で企業候補・公式サイトを発見 | https://brave.com/search/api/ | `BRAVE_SEARCH_API_KEY` |
| EDINET | 上場企業の裏付け（公的情報源として加点） | https://api.edinet-fsa.go.jp/ | `EDINET_API_KEY` |

検索エンジンは `SearchEngine` インターフェースで抽象化しており（`src/lib/discovery/providers/web-search.ts`）、
Brave 以外へ差し替える場合はこの interface を実装するだけで済みます。

**注意**: Web検索由来の候補は最も確度が低い情報源として扱われ、単独では `verified` になりません（必ず本人確認を通ります）。
利用規約で禁止されているサイト・ログイン必須サイト・CAPTCHA 保護サイト・robots.txt で禁止されたページはクロールしません。

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
| `BRAVE_SEARCH_API_KEY` | - | Brave Search API キー（任意。Web検索での企業発見） |
| `EDINET_API_KEY` | - | EDINET API キー（任意。上場企業の裏付け） |
| `DISCOVERY_MODE` | - | `hybrid`（既定） / `gbiz` / `places` / `search`。使用する情報源 |
| `DISCOVERY_MAX_PROVIDER_REQUESTS` | - | 1回の探索での Provider 呼び出し上限（既定 60） |
| `DISCOVERY_MAX_CANDIDATES` | - | 1回の探索で保持する候補数の上限（既定 600） |
| `DISCOVERY_MAX_VERIFICATION_REQUESTS` | - | 本人確認で行う HTTP 取得の上限（既定 300） |
| `DISCOVERY_MAX_AI_CALLS` | - | 1回の探索で許可する AI 呼び出し上限（既定 200） |
| `DISCOVERY_MAX_EXECUTION_MINUTES` | - | 1回の探索の実行時間上限（既定 60分） |
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
| `discovery_runs` | 企業探索の実行単位。条件 / モード / フェーズ（discovering→verifying→promoting→done）/ 情報源ごとの統計 / 予算 / cursor |
| `discovery_candidates` | 探索で見つけた企業候補。**確認を通るまで `companies` には入れない**。本人確認スコア・シグナル・情報源・採用シグナル・却下理由・昇格先 `company_id` |
| `company_sources` | 企業情報の出所。どの Provider が何を観測したかを企業ごとにすべて残す（`(company_id, provider, external_id)` でユニーク） |
| `search_jobs` / `search_job_items` | 企業検索ジョブと検出企業（new / duplicate / skipped / failed）。GビズINFO 単独の旧検索 |
| `crawl_jobs` / `analysis_jobs` | クロール / 分析ジョブ（pending / processing / completed / failed / retrying / cancelled、試行回数、エラー） |
| `system_logs` | 検索・登録・クロール・分析・API・エラーのログ |
| `ai_usage_logs` | Claude API のトークン使用量 |
| `suppression_list` | 営業拒否 / 配信停止 / 送信禁止 / 返信不要 の抑止リスト（企業・メール・ドメイン単位） |
| `services`, `campaigns`, `email_templates`, `email_messages`, `email_replies`, `contacts`, `activities` | Phase 4 以降用（空でも動作） |
| ビュー `company_overview` | 企業 + 最新分析をフラット化（一覧・CSV・ダッシュボード用） |
| 関数 `claim_job` | `FOR UPDATE SKIP LOCKED` でジョブを取得し、同時実行時の二重処理を防止。stale な processing を自動復旧（`search_jobs` / `crawl_jobs` / `analysis_jobs` / `discovery_runs` に対応） |
| 関数 `increment_search_job_counters`, `dashboard_stats` | カウンタのアトミック加算 / ダッシュボード集計 |
| トリガー `set_updated_at` | `updated_at` の自動更新 |

## 12. 処理フローとジョブキュー

1 リクエストで 100 社を同期処理せず、すべてジョブとして分割します。

```
[企業を探す] → discovery_runs 作成 → after() で即時処理開始
   ├ discovering: 複数 Provider へクエリを分割投入 → 統合 → 重複排除 → discovery_candidates に保存
   │              （時間切れ・予算切れなら cursor を保存して次回再開）
   ├ verifying  : 法人番号の確定 → 公式サイト確認 → 本人確認スコア算定
   │              → verified / needs_review / rejected を確定
   ├ promoting  : verified のみ companies へ登録 → company_sources を記録 → crawl_jobs 投入
   ├ crawl job  : 公式HP判定（閾値 60 未満は "要確認" にして保存しない）→ クロール → 連絡先/SNS/営業拒否抽出 → analysis_jobs 投入
   └ analysis   : コンテキスト構築 → Claude → Zod 検証 → スコアリング → 保存 → suppression_list 更新
```

旧「検索ジョブ」（GビズINFO 単独）も `search_jobs` としてそのまま動作します。

ジョブランナー（`src/lib/jobs/runner.ts`）は次の 3 経路で起動します。

| 経路 | 用途 |
| --- | --- |
| `after()`（Server Action 直後） | 検索開始・手動追加・再解析の直後に即時処理 |
| 検索進捗画面のポーリング → `POST /api/jobs/process` | 画面を開いている間は処理が進む |
| Vercel Cron → `GET /api/cron/process-jobs`（毎分） | 画面を閉じても処理が進む（`vercel.json`） |

失敗ジョブは `max_attempts`（3回）まで自動再試行し、超えると `failed`。ジョブ画面 / 検索進捗画面から **失敗した企業のみ再実行** できます。

## 12.5 企業探索（Multi-Source Discovery）

### 何をしているか

1 つの情報源だけでは、日本の中小企業は取りこぼします（GビズINFO には URL が無い、地図には載っているが法人番号が分からない、など）。
そこで **複数の情報源から候補を集め、突き合わせてから企業として確定** します。

```
複数ソースから発見 → 情報統合 → 本人確認 → 重複排除 → 公式サイト確認 → 営業候補企業へ昇格
```

### 情報源（Provider）

| Provider | 役割 | 単体の確度 | 必要なキー |
| --- | --- | --- | --- |
| GビズINFO | **Source of Truth**。法人番号・商号・所在地の正 | 90 | `GBIZ_API_KEY` |
| EDINET | 上場企業の裏付け | 85 | `EDINET_API_KEY`（任意） |
| 公式サイト確認 | 会社名・所在地・電話・ドメインの照合 | 判定結果 | 不要 |
| Google Places | 地域の中小企業・工場の発見 | 65 | `GOOGLE_MAPS_API_KEY`（任意） |
| Web検索 | 取りこぼしの補完・公式サイト候補 | 30 | `BRAVE_SEARCH_API_KEY`（任意） |

キーが無い Provider は **探索全体を止めずにスキップ** し、理由が進捗画面と `npm run preflight` に表示されます。

### クエリの分割（Query Planning）

「大阪府 製造業」の 1 クエリでは数十社しか取れません。次のように分割します。

- **業種の細分化**: 製造業 → 金属加工 / 精密加工 / 機械製造 / 自動車部品 / 樹脂 / 印刷 …（`taxonomy.ts`）
- **市区町村での分割**: 大阪府 → 大阪市 / 東大阪市 / 堺市 / 八尾市 …（`query-sharding.ts`）
- **ページング**: GビズINFO は shard ごとにページを進める
- 目標件数に届かない場合のみ、未使用の shard・検索語で **追加探索** します

### 情報の統合（Source of Truth）

同じ企業が複数の情報源から見つかった場合、**項目ごとに** 優先度の高い出所の値を採用します
（`gbiz 100 > edinet 90 > official_web 80 > google_places 60 > web_search 30`）。
低い出所の値で既存の値を上書きすることはありません。観測はすべて `company_sources` に残るため、
企業詳細画面の「情報源」セクションで **どの値がどこから来たか** を後から確認できます。

### 本人確認（Verification Score 0-100）

| シグナル | 配点 |
| --- | --- |
| 法人番号あり | 40 |
| 公式サイトに会社名 | 20 |
| 所在地が一致 | 15 |
| 電話番号が一致 | 10 |
| 公式ドメイン確認 | 10 |
| 公的情報源で確認（GビズINFO / EDINET） | 10 |
| 複数の情報源で一致 | 5 |

- **80点以上 → `verified`**: `companies` へ昇格し、クロール・AI分析へ進みます
- **60点以上 → `needs_review`**: 「確認待ちリスト」に入り、**人が承認するまで企業登録されません**
- **60点未満 → `rejected`**: 登録しません

配点としきい値は `src/lib/config/discovery.ts` の 1 箇所で変更できます。

### 集計の見方（重要）

候補の集計は **2つの軸** に分かれています。足し合わせないでください。

| 軸 | 意味 |
| --- | --- |
| **新規候補数**（`discovered_count`） | 今回はじめて見つけた候補。`確認済 + 要確認 + 対象外 + 確認中 + 失敗` の合計 |
| **重複**（`duplicate_count`） | すでに `companies` に登録済みだった候補。**新規候補数には含みません** |

`新規候補数 + 重複 = 保存した候補の総数` になります。
例: 全66件 = 新規候補49件（確認済16 / 要確認17 / 対象外16）+ 重複17件。

これらのカウンタは加算ではなく **`discovery_candidates` の実データから毎回引き直します**。
確認待ちリストでの承認・却下でも数字がズレません。

### 重複排除

`法人番号 > ドメイン > 電話番号 > 社名+所在地 > 社名+市区町村 > 社名の類似度（0.88以上・同一市区町村）` の順に判定します。
既存の `companies` とも突き合わせ、登録済みの企業は `duplicate` として記録するだけで再登録しません。

### API 予算

1 回の探索で使える Provider 呼び出し・候補数・確認リクエスト・AI 呼び出し・実行時間に上限があります（`DISCOVERY_MAX_*`）。
上限に達すると **その時点までの結果を保存して安全に停止** し、`partially_completed` になります。
探索件数が少ない場合は上限も自動的に縮小されます（`scaleBudgetForRequest`）。

### 確認待ちリスト（Review Queue）

画面: **サイドバー → 確認待ち**（`/review`）

- 本人確認スコアと、どのシグナルが一致 / 不一致だったかを表示
- **承認** → `companies` へ登録し、クロール・AI分析へ
- **対象外にする** → 却下（登録しません）
- **公式サイトを修正して再確認** → URL を直して自動確認をやり直し

CLI からも操作できます。

```bash
npm run discovery:review                                   # 一覧
npm run discovery:review -- --approve <candidate-id>       # 承認
npm run discovery:review -- --reject <candidate-id> --reason "理由"
```

### 検証レポート

```bash
npm run ai:cost            # Claude API の実使用量と費用（記録済みトークン数から算出）
npm run ai:cost -- --project 50   # 実績平均から50社分の費用を予測
npm run env:check          # Live 実行に必要な環境変数の充足チェック（値は表示しません）
npm run discovery:verify   # 直近の探索ランを検証（企業ごとの結果・精度指標・Provider別貢献・安全検査）
npm run discovery:verify -- --run <run-id>
```

`discovery:verify` は **GビズINFO / Google Places / Web検索それぞれでしか見つからなかった企業** を集計するため、
Multi-Source 化に実際の上積みがあったかを数字で確認できます。

### CLI での実行

```bash
# 大阪府 / 製造業 / 20社 を探索（DATA_MODE=live なら実API）
npm run discovery -- --prefecture 大阪府 --industry manufacturing --count 20

# 情報源を限定する
npm run discovery -- --prefecture 大阪府 --industry manufacturing --count 20 --mode gbiz

# 業種詳細を指定する
npm run discovery -- --prefecture 大阪府 --subcategory precision_processing --count 20

# モックデータで動作だけ確認する（API を消費しません）
npm run discovery:mock -- --count 12
```

## 13. モックモードと実データの切り替え

`DATA_MODE=mock` では次がモックに置き換わります（本番コードとモックは Provider インターフェースで分離）。

| 対象 | 実装 | モック |
| --- | --- | --- |
| GビズINFO | `integrations/gbiz/client.ts` | `integrations/gbiz/mock.ts`（決定論的なダミー法人 180 社） |
| Google Places | `integrations/google-places/index.ts` | 同ファイル内 `MockPlacesProvider` |
| 探索 Provider 群 | `discovery/providers/{gbiz,google-places,web-search,edinet}.ts` | `discovery/providers/mock.ts`（情報源ごとに意図的に重複する候補を返す） |
| Claude | `ai/anthropic.ts` | `ai/mock.ts`（クロール結果からヒューリスティックに分析） |
| Web サイト | 実 HTTP | `mock-*.example.jp` ドメインのみ合成 HTML（`integrations/http/mock-site.ts`） |

クローラー自体は API キー不要のため、モックモードでも実在サイトの URL を手動追加すれば実クロールされます（AI 分析はモック）。
画面上部に黄色いバナーでモード（mock / 認証無効）を常時表示します。

## 14. テスト / Lint / ビルド

```bash
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm test            # Vitest（重複判定 / URL正規化 / メール抽出 / 営業拒否判定 / AIスキーマ / スコア計算 / クローラー /
                    #         実サイト相当のフィクスチャ / クエリ生成・分割 / 情報統合 / 本人確認スコア /
                    #         API予算・再試行 / Provider 失敗の隔離 / 公式サイト確認）
npm run build       # next build
```

### 実企業データでの検証（Phase 3.5）

実APIに切り替えて、少数の実企業で取得・分析の精度を確認する手順です。

```bash
# 1. 接続診断（キーの有効性・モデル名・外部到達性を確認。Claude はトークンを消費しません）
npm run preflight

# 2. 実企業テスト（まずは10社から。DATA_MODE=live が必要）
npm run test:real -- --count 10 --prefecture 大阪府 --industry manufacturing

# 3. 保存済みデータの検証レポートだけを再表示
npm run verify
npm run verify -- --job <検索ジョブID>
```

`test:real` は検索ジョブを作成し、完了までジョブを処理してから検証レポートを表示します。レポートには次が含まれます。

- 企業ごとの取得結果（法人番号 / 所在地 / 公式HPと信頼度 / 採用ページ / 新卒・中途 / 問い合わせ / メール / 電話 / SNS / 営業拒否 / クロールページ / AI企業概要 / 各スコア / 営業ランク / Evidence）
- 精度指標（公式サイト判定率・クロール成功率・採用ページ検出率・問い合わせ情報検出率・SNS検出率・AI分析成功率・営業拒否検出・ランク分布）
- ハルシネーション検査（Evidence URL の実在性 / メールが本文に実在するか / 営業拒否企業の抑止リスト登録 / 根拠なく「営業可」と判定していないか / 事実と推測の分離 / 重複 / スコア範囲）

段階的に `--count 10` → `50` → `100` と増やし、各段階でレポートの精度指標と検査結果を確認してから次に進んでください。

### 企業探索の実データ検証

```bash
# 1. 接続診断（情報源ごとの利用可否・本人確認しきい値・予算も表示されます）
npm run preflight

# 2. 大阪府 / 製造業 / 20社 を探索
npm run discovery -- --prefecture 大阪府 --industry manufacturing --count 20

# 3. 自動確認できなかった候補を人が確認する
npm run discovery:review
```

`npm run discovery` は探索完了後に、情報源ごとの統計・確認済み一覧・確認待ち一覧・却下理由を表示します。
**確認済みになった企業だけが `companies` に登録されている** ことを、この出力と企業一覧の両方で確認してください。

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
- 企業情報の手動編集フォーム（連絡可否・公式サイト・確認待ち候補の承認のみ対応）
- 自治体・工業会などの公開企業一覧ページの自動スクレイピング（検索語の生成のみ行い、一覧ページ自体の解析は未実装）
- 探索条件の保存・定期実行（Cron からの自動探索）

**次フェーズで実装すべき内容（DB は準備済み）**

1. `services` 登録画面と `company_analysis.recommended_topics` × `services.target_issues` の AI マッチング
2. `email_templates` / `campaigns` と企業ごとの営業メール AI 生成（`suppression_list` と `sales_contact_allowed='false'` を必ず除外）
3. Gmail API 送信（`email_messages`）と返信取り込み（`email_replies`）、未返信企業の追客スケジュール
4. `contacts` の担当者抽出（代表者・採用担当など）
5. 定期再クロール（`last_crawled_at` ベース）と分析差分の通知
6. 商談化率 / 返信率の集計（`activities`）
7. 探索条件のテンプレート保存と定期実行（`discovery_runs` を Cron から作成）
8. 公開企業一覧ページ（自治体・工業会）の解析による候補発見の上積み
