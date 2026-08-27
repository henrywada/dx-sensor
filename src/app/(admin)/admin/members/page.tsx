import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listMembers, listTenants } from "@/lib/admin/members";
import { MembersView } from "./MembersView";

type SearchParams = Promise<{ tenantId?: string }> | { tenantId?: string };

export default async function MembersPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  const tenantId =
    typeof params.tenantId === "string" && params.tenantId.length > 0
      ? params.tenantId
      : null;

  const [tenants, members] = await Promise.all([
    listTenants(),
    listMembers(tenantId),
  ]);

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
        <h1 className="mt-3 text-2xl font-bold text-ink">メンバー管理</h1>
        <p className="mt-1 text-sm text-ink-soft">
          テナントごとのメンバーとロールを管理します。
        </p>
      </div>
      <MembersView
        tenants={tenants}
        members={members}
        initialTenantId={tenantId}
      />
    </div>
  );
}
