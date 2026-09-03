"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  MEMBER_ROLES,
  type MemberRole,
  type MemberRow,
  type TenantOption,
} from "@/lib/admin/memberTypes";
import {
  addMemberAction,
  removeMemberAction,
  updateMemberRoleAction,
} from "./actions";

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "owner（所有者）",
  admin: "admin（管理者）",
  viewer: "viewer（閲覧）",
  developer: "developer（開発者）",
  admin_tenant: "admin_tenant（テナント管理画面）",
};

type Props = {
  tenants: TenantOption[];
  members: MemberRow[];
  initialTenantId: string | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MembersView({ tenants, members, initialTenantId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tenantFilter, setTenantFilter] = useState(initialTenantId ?? "");
  const [addTenantId, setAddTenantId] = useState(
    initialTenantId ?? tenants[0]?.id ?? ""
  );
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  function applyTenantFilter(next: string) {
    setTenantFilter(next);
    const params = new URLSearchParams();
    if (next) params.set("tenantId", next);
    const qs = params.toString();
    router.push(qs ? `/admin/members?${qs}` : "/admin/members");
  }

  function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    setTempPassword(null);
    startTransition(async () => {
      const result = await addMemberAction({
        tenantId: addTenantId,
        email,
        role,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "追加しました。");
      if (result.tempPassword) setTempPassword(result.tempPassword);
      setEmail("");
      router.refresh();
    });
  }

  function onRoleChange(memberId: string, nextRole: MemberRole) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await updateMemberRoleAction({
        memberId,
        role: nextRole,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "更新しました。");
      router.refresh();
    });
  }

  function onRemove(member: MemberRow) {
    if (
      !window.confirm(
        `${member.email}（${member.tenantName} / ${member.role}）を削除しますか？`
      )
    ) {
      return;
    }
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await removeMemberAction({ memberId: member.id });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "削除しました。");
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="text-base font-bold text-ink">メンバーを追加</h2>
        <p className="mt-1 text-sm text-ink-soft">
          既存ユーザーはメールで紐付けます。未登録の場合はアカウントを新規作成します。
        </p>
        <form onSubmit={onAdd} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm">
            <span className="text-ink-soft">テナント</span>
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-ink"
              value={addTenantId}
              onChange={(e) => setAddTenantId(e.target.value)}
              required
              disabled={isPending || tenants.length === 0}
            >
              {tenants.length === 0 && <option value="">テナントなし</option>}
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm sm:col-span-1 lg:col-span-1">
            <span className="text-ink-soft">メールアドレス</span>
            <input
              type="email"
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-ink"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
              disabled={isPending}
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-soft">ロール</span>
            <select
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-ink"
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
              disabled={isPending}
            >
              {MEMBER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={isPending || !addTenantId}
              className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? "処理中…" : "追加"}
            </button>
          </div>
        </form>
        {error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="mt-3 text-sm text-signal" role="status">
            {message}
          </p>
        )}
        {tempPassword && (
          <p className="mt-2 rounded-md bg-signal-soft px-3 py-2 text-sm text-ink">
            仮パスワード（この画面でのみ表示）:{" "}
            <code className="font-mono font-semibold">{tempPassword}</code>
          </p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-ink">メンバー一覧</h2>
            <p className="mt-1 text-sm text-ink-soft">
              {members.length} 件
              {tenantFilter ? "（フィルター適用中）" : ""}
            </p>
          </div>
          <label className="block text-sm">
            <span className="text-ink-soft">テナントで絞り込み</span>
            <select
              className="mt-1 block min-w-[12rem] rounded-md border border-line bg-white px-3 py-2 text-ink"
              value={tenantFilter}
              onChange={(e) => applyTenantFilter(e.target.value)}
              disabled={isPending}
            >
              <option value="">すべて</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <th className="px-2 py-2 font-medium">メール</th>
                <th className="px-2 py-2 font-medium">テナント</th>
                <th className="px-2 py-2 font-medium">ロール</th>
                <th className="px-2 py-2 font-medium">追加日</th>
                <th className="px-2 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-6 text-ink-soft">
                    メンバーがいません。
                  </td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr key={m.id} className="border-b border-line/60">
                    <td className="px-2 py-2 text-ink">{m.email}</td>
                    <td className="px-2 py-2 text-ink">
                      <span className="block">{m.tenantName}</span>
                      {m.tenantSlug && (
                        <span className="text-xs text-ink-soft">{m.tenantSlug}</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        className="rounded-md border border-line bg-white px-2 py-1 text-ink"
                        value={m.role}
                        disabled={isPending}
                        onChange={(e) =>
                          onRoleChange(m.id, e.target.value as MemberRole)
                        }
                      >
                        {MEMBER_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2 text-ink-soft whitespace-nowrap">
                      {formatDate(m.createdAt)}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        className="text-sm text-red-600 hover:underline disabled:opacity-50"
                        disabled={isPending}
                        onClick={() => onRemove(m)}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
