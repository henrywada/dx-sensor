import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listTenantsDetailed } from "@/lib/admin/tenants";
import { TenantsView } from "./TenantsView";

export default async function TenantsPage() {
  const tenants = await listTenantsDetailed();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
        >
          <ChevronLeft className="h-4 w-4" />
          管理画面に戻る
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-ink">テナント一覧</h1>
        <p className="mt-1 text-sm text-ink-soft">
          登録済みテナントの一覧・詳細を確認します。
        </p>
      </div>
      <TenantsView tenants={tenants} />
    </div>
  );
}
