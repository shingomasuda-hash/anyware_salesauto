import { PageHeader } from "@/components/layout/page-header";
import { NewCompanyForm } from "./new-company-form";

export const metadata = { title: "企業を手動追加" };

export default function NewCompanyPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader title="企業を手動追加" description="企業名と公式URLを入力すると、企業情報の取得 → サイトクロール → AI分析まで自動で実行します。" />
      <NewCompanyForm />
    </div>
  );
}
