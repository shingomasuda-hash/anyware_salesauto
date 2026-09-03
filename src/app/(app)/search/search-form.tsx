"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { COMPANY_SIZE_PRESETS, CORPORATE_TYPES, INDUSTRIES, PREFECTURE_NAMES } from "@/lib/companies/constants";
import { createSearchJobAction, type ActionState } from "@/app/(app)/actions";

function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

export function SearchForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createSearchJobAction, null);
  const errors = state?.errors ?? {};
  return (
    <form action={action} className="space-y-5 rounded-lg border p-6">
      {state && !state.ok ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="都道府県" htmlFor="prefecture" error={errors.prefecture}>
          <NativeSelect id="prefecture" name="prefecture" defaultValue="大阪府">
            <option value="">指定なし</option>
            {PREFECTURE_NAMES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="市区町村" htmlFor="city" error={errors.city} hint="部分一致（例: 大阪市、東大阪市）">
          <Input id="city" name="city" placeholder="任意" />
        </Field>
        <Field label="業種" htmlFor="industry" error={errors.industry}>
          <NativeSelect id="industry" name="industry" defaultValue="manufacturing">
            <option value="">指定なし</option>
            {INDUSTRIES.map((i) => (
              <option key={i.key} value={i.key}>
                {i.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="キーワード" htmlFor="keyword" error={errors.keyword} hint="法人名に含まれる語（GビズINFO の名称検索）">
          <Input id="keyword" name="keyword" placeholder="任意" />
        </Field>
        <Field label="企業規模" htmlFor="companySize" error={errors.companySize}>
          <NativeSelect id="companySize" name="companySize" defaultValue="small">
            {COMPANY_SIZE_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="従業員数 下限" htmlFor="employeeMin" error={errors.employeeMin}>
            <Input id="employeeMin" name="employeeMin" type="number" min={0} placeholder="例: 20" />
          </Field>
          <Field label="従業員数 上限" htmlFor="employeeMax" error={errors.employeeMax}>
            <Input id="employeeMax" name="employeeMax" type="number" min={0} placeholder="例: 300" />
          </Field>
        </div>
        <Field label="法人種別" htmlFor="corporateType" error={errors.corporateType}>
          <NativeSelect id="corporateType" name="corporateType" defaultValue="">
            <option value="">指定なし</option>
            {CORPORATE_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="検索件数（登録する企業数）" htmlFor="requestedCount" error={errors.requestedCount} hint="1〜500。既存企業も含めた件数です">
          <Input id="requestedCount" name="requestedCount" type="number" min={1} max={500} defaultValue={100} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="requireWebsite" className="size-3.5 accent-primary" /> 公式HPがある企業のみ
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="requireRecruiting" className="size-3.5 accent-primary" /> 採用活動あり（分析後に一覧で絞り込み）
        </label>
      </div>
      <div className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "開始中…" : "検索を開始"}
        </Button>
      </div>
    </form>
  );
}
