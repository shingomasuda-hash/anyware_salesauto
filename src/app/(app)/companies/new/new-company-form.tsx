"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { INDUSTRIES } from "@/lib/companies/constants";
import { addCompanyAction, type ActionState } from "@/app/(app)/actions";

function Field({ label, name, error, children }: { label: string; name: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

export function NewCompanyForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(addCompanyAction, null);
  const errors = state?.errors ?? {};
  return (
    <form action={action} className="space-y-5 rounded-lg border p-6">
      {state && !state.ok ? (
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}
      <Field label="企業名 *" name="companyName" error={errors.companyName}>
        <Input id="companyName" name="companyName" required placeholder="株式会社ABC" />
      </Field>
      <Field label="公式URL" name="websiteUrl" error={errors.websiteUrl}>
        <Input id="websiteUrl" name="websiteUrl" type="url" placeholder="https://example.co.jp" />
        <p className="text-xs text-muted-foreground">未入力の場合は Google Places（設定時）で公式サイト候補を探索します。</p>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="所在地" name="address" error={errors.address}>
          <Input id="address" name="address" placeholder="大阪府大阪市中央区..." />
        </Field>
        <Field label="法人番号" name="corporateNumber" error={errors.corporateNumber}>
          <Input id="corporateNumber" name="corporateNumber" inputMode="numeric" placeholder="13桁" />
        </Field>
      </div>
      <Field label="業種" name="industry" error={errors.industry}>
        <NativeSelect id="industry" name="industry" defaultValue="">
          <option value="">未選択</option>
          {INDUSTRIES.map((i) => (
            <option key={i.key} value={i.key}>
              {i.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "登録中…" : "登録して解析を開始"}
        </Button>
      </div>
    </form>
  );
}
