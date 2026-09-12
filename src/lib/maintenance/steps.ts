/**
 * 保守処理の順番の定義。
 *
 * 順番そのものに意味がある。特に「公式サイトURLの再点検」は「再クロール投入」より前。
 * 逆にすると、公式サイトでないURL（法人情報DB・名簿ページ）を20ページずつ読みに行く。
 * 実際にその事故を起こしたため、順番はテストで固定する。
 */
export type MaintenanceStep = {
  /** 画面に出す説明 */
  title: string;
  /** scripts/ 配下のファイル名 */
  script: string;
  /** 常に渡す引数 */
  args: string[];
  /** --apply のときに追加する引数 */
  applyArgs?: string[];
  /** --apply のときだけ実行する（実費・時間がかかるもの） */
  applyOnly?: boolean;
  /** 失敗したら後続を止める */
  required?: boolean;
};

export const MAINTENANCE_STEPS: MaintenanceStep[] = [
  {
    title: "スキーマ確認（マイグレーションが適用されているか）",
    script: "check-schema.ts",
    args: [],
    required: true,
  },
  {
    title: "登録に失敗したまま残っている候補の復旧",
    script: "repair-candidates.ts",
    args: [],
    applyArgs: ["--apply"],
  },
  {
    title: "出典（company_sources）の重複整理",
    script: "dedupe-company-sources.ts",
    args: [],
    applyArgs: ["--apply"],
  },
  {
    title: "公式サイトURLの再点検（法人情報DB・名簿ページを外す）",
    script: "recheck-sites.ts",
    args: [],
    applyArgs: ["--apply"],
  },
  {
    title: "採用状況が未判定の企業の再クロール投入",
    script: "recrawl.ts",
    args: ["--missing-target"],
    applyArgs: ["--apply"],
  },
  {
    title: "キューの処理（クロール実行）",
    script: "run-jobs.ts",
    args: ["--drain"],
    applyOnly: true,
  },
];
