import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { EMPLOYEE_RANGES, INDUSTRIES, PREFECTURE_NAMES, SALES_RANKS } from "@/lib/companies/constants";
import { RECRUIT_TARGET_OPTIONS } from "@/lib/companies/recruit-target";
import { SORT_OPTIONS, type CompanyFilters } from "@/lib/companies/filters";

function Check({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
      <input type="checkbox" name={name} value="1" defaultChecked={checked} className="size-3.5 accent-primary" />
      {label}
    </label>
  );
}

/** 企業一覧のフィルタ（GET フォーム。URL に状態を持たせて共有・CSV出力と共用） */
export function CompanyFilterForm({ filters }: { filters: CompanyFilters }) {
  return (
    <form method="get" className="rounded-lg border bg-muted/20 p-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <div className="col-span-2">
          <Input name="q" placeholder="企業名 / ドメイン / 法人番号" defaultValue={filters.q ?? ""} />
        </div>
        <NativeSelect name="prefecture" defaultValue={filters.prefecture ?? ""}>
          <option value="">都道府県</option>
          {PREFECTURE_NAMES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="recruitTarget" defaultValue={filters.recruitTarget ?? ""}>
          <option value="">採用状況（すべて）</option>
          {RECRUIT_TARGET_OPTIONS.filter((o) => o.key !== "no_signal").map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="industry" defaultValue={filters.industry ?? ""}>
          <option value="">業種</option>
          {INDUSTRIES.map((i) => (
            <option key={i.key} value={i.key}>
              {i.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="employeeRange" defaultValue={filters.employeeRange ?? ""}>
          <option value="">従業員規模</option>
          {EMPLOYEE_RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="rank" defaultValue={filters.rank ?? ""}>
          <option value="">営業ランク</option>
          {SALES_RANKS.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}: {r.description}
            </option>
          ))}
        </NativeSelect>
        <Input name="minPriority" type="number" min={0} max={100} placeholder="営業スコア ≥" defaultValue={filters.minPriority ?? ""} />
        <Input name="minRecruitIssue" type="number" min={0} max={100} placeholder="採用課題 ≥" defaultValue={filters.minRecruitIssue ?? ""} />
        <Input name="maxSns" type="number" min={0} max={100} placeholder="SNSスコア ≤" defaultValue={filters.maxSns ?? ""} />
        <Input name="maxWeb" type="number" min={0} max={100} placeholder="Webスコア ≤" defaultValue={filters.maxWeb ?? ""} />
        <NativeSelect name="sort" defaultValue={filters.sort}>
          {SORT_OPTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="perPage" defaultValue={String(filters.perPage)}>
          {[25, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n}件 / ページ
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* 既定は「採用の痕跡がある企業」のみ。採用ページの有無では絞らない */}
        <Check name="includeNoRecruitSignal" label="採用の痕跡なしも表示" checked={filters.includeNoRecruitSignal} />
        <Check name="recruiting" label="採用中（AI判定）" checked={filters.recruiting} />
        <Check name="hasWebsite" label="公式HPあり" checked={filters.hasWebsite} />
        <Check name="hasContact" label="問い合わせ先あり" checked={filters.hasContact} />
        <Check name="hasEmail" label="メールアドレスあり" checked={filters.hasEmail} />
        <Check name="hasOutreach" label="文面あり" checked={filters.hasOutreach} />
        <Check name="includeLowConfidence" label="確度が低い企業も表示" checked={filters.includeLowConfidence} />
        <Check name="includeRestricted" label="営業不可も表示" checked={filters.includeRestricted} />
        <Check name="includeUnverifiedSite" label="公式HP未確認も表示" checked={filters.includeUnverifiedSite} />
        <Check name="excludeRestricted" label="営業可のみ（拒否・未確認を除外）" checked={filters.excludeRestricted} />
        <Check name="unanalyzed" label="未解析" checked={filters.unanalyzed} />
        <Check name="needsReview" label="HP要確認" checked={filters.needsReview} />
        <div className="ml-auto flex gap-2">
          <Button asChild type="button" variant="ghost" size="sm">
            <Link href="/companies">リセット</Link>
          </Button>
          <Button type="submit" size="sm">
            絞り込む
          </Button>
        </div>
      </div>
    </form>
  );
}
