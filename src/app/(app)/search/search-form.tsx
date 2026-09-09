"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { COMPANY_SIZE_PRESETS, CORPORATE_TYPES, INDUSTRIES, PREFECTURE_NAMES } from "@/lib/companies/constants";
import { DISCOVERY_MODE_OPTIONS } from "@/lib/discovery/criteria";
import { allSubcategoryOptions } from "@/lib/discovery/taxonomy";
import { createDiscoveryRunAction, type ActionState } from "@/app/(app)/actions";
import type { ProviderAvailability } from "@/lib/discovery/providers";

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

const PROVIDER_LABELS: Record<string, string> = {
  gbiz: "GビズINFO",
  google_places: "Google Places",
  web_search: "Web検索",
  edinet: "EDINET",
  official_web: "公式サイト確認",
};

export function SearchForm({ availability }: { availability: ProviderAvailability[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createDiscoveryRunAction, null);
  const [industry, setIndustry] = useState("manufacturing");
  const errors = state?.errors ?? {};
  const subcategories = allSubcategoryOptions(industry);
  const unavailable = availability.filter((a) => !a.available);

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
          <NativeSelect id="industry" name="industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option value="">指定なし</option>
            {INDUSTRIES.map((i) => (
              <option key={i.key} value={i.key}>
                {i.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="業種詳細"
          htmlFor="industrySubcategory"
          error={errors.industrySubcategory}
          hint="未指定なら業種を自動で細分化して探索します（例: 金属加工・精密加工…）"
        >
          <NativeSelect id="industrySubcategory" name="industrySubcategory" defaultValue="" disabled={subcategories.length === 0}>
            <option value="">すべて（自動展開）</option>
            {subcategories.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="探索方法" htmlFor="mode" error={errors.mode} hint="複数の情報源を突き合わせるほど本人確認の精度が上がります">
          <NativeSelect id="mode" name="mode" defaultValue="auto">
            {DISCOVERY_MODE_OPTIONS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="キーワード" htmlFor="keyword" error={errors.keyword} hint="社名や事業内容に含まれる語">
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
        <Field label="探索件数（営業候補にする企業数）" htmlFor="requestedCount" error={errors.requestedCount} hint="1〜500。本人確認を通った企業だけが登録されます">
          <Input id="requestedCount" name="requestedCount" type="number" min={1} max={500} defaultValue={50} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="requireWebsite" defaultChecked className="size-3.5 accent-primary" /> 公式HPを確認できた企業のみ
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" name="requireRecruiting" className="size-3.5 accent-primary" /> 採用活動あり
        </label>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">利用できる情報源</p>
        <p className="mt-1">
          {availability
            .filter((a) => a.available)
            .map((a) => PROVIDER_LABELS[a.name] ?? a.name)
            .join(" / ") || "なし"}
        </p>
        {unavailable.length > 0 ? (
          <ul className="mt-2 space-y-0.5">
            {unavailable.map((a) => (
              <li key={a.name}>
                ・{PROVIDER_LABELS[a.name] ?? a.name}: {a.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "開始中…" : "探索を開始"}
        </Button>
      </div>
    </form>
  );
}
