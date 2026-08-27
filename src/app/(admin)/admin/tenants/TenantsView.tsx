"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TenantListItem } from "@/lib/admin/tenantTypes";
import { createTenantAction, updateTenantAction } from "./actions";

type Props = {
  tenants: TenantListItem[];
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

export function TenantsView({ tenants }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [isPremium, setIsPremium] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editPremium, setEditPremium] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function suggestSlugFromName(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(suggestSlugFromName(value));
    }
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await createTenantAction({
        name,
        slug,
        isPremium,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "作成しました。");
      setName("");
      setSlug("");
      setIsPremium(false);
      setSlugTouched(false);
      router.refresh();
    });
  }

  function startEdit(t: TenantListItem) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditSlug(t.slug);
    setEditPremium(t.isPremium);
    setMessage(null);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await updateTenantAction({
        tenantId: editingId,
        name: editName,
        slug: editSlug,
        isPremium: editPremium,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "更新しました。");
      setEditingId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="text-base font-bold text-ink">テナントを作成</h2>
        <p className="mt-1 text-sm text-ink-soft">
          契約先を追加します。メンバーの紐付けはメンバー管理から行います。
        </p>
        <form
          onSubmit={onCreate}
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="block text-sm">
            <span className="text-ink-soft">テナント名</span>
            <input
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-ink"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="例: サンプル商事"
              required
              disabled={isPending}
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-soft">スラッグ</span>
            <input
              className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-ink"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder="sample-corp"
              required
              disabled={isPending}
            />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={isPremium}
              onChange={(e) => setIsPremium(e.target.checked)}
              disabled={isPending}
            />
            Premium
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {isPending ? "処理中…" : "作成"}
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
      </section>

      <section className="rounded-lg border border-line bg-white p-5">
        <h2 className="text-base font-bold text-ink">テナント一覧</h2>
        <p className="mt-1 text-sm text-ink-soft">{tenants.length} 件</p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <th className="px-2 py-2 font-medium">名前</th>
                <th className="px-2 py-2 font-medium">スラッグ</th>
                <th className="px-2 py-2 font-medium">Premium</th>
                <th className="px-2 py-2 font-medium">メンバー</th>
                <th className="px-2 py-2 font-medium">作成日</th>
                <th className="px-2 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-ink-soft">
                    テナントがありません。
                  </td>
                </tr>
              ) : (
                tenants.map((t) =>
                  editingId === t.id ? (
                    <tr key={t.id} className="border-b border-line/60 bg-signal-soft/30">
                      <td className="px-2 py-2" colSpan={6}>
                        <form
                          onSubmit={onSaveEdit}
                          className="flex flex-wrap items-end gap-3"
                        >
                          <label className="block text-sm">
                            <span className="text-ink-soft">名前</span>
                            <input
                              className="mt-1 block rounded-md border border-line bg-white px-2 py-1"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              required
                              disabled={isPending}
                            />
                          </label>
                          <label className="block text-sm">
                            <span className="text-ink-soft">スラッグ</span>
                            <input
                              className="mt-1 block rounded-md border border-line bg-white px-2 py-1 font-mono"
                              value={editSlug}
                              onChange={(e) => setEditSlug(e.target.value)}
                              required
                              disabled={isPending}
                            />
                          </label>
                          <label className="flex items-center gap-2 pb-1 text-sm">
                            <input
                              type="checkbox"
                              checked={editPremium}
                              onChange={(e) => setEditPremium(e.target.checked)}
                              disabled={isPending}
                            />
                            Premium
                          </label>
                          <button
                            type="submit"
                            disabled={isPending}
                            className="rounded-md bg-signal px-3 py-1.5 text-sm text-white disabled:opacity-50"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={cancelEdit}
                            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-soft"
                          >
                            キャンセル
                          </button>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={t.id} className="border-b border-line/60">
                      <td className="px-2 py-2 font-medium text-ink">{t.name}</td>
                      <td className="px-2 py-2 font-mono text-ink-soft">
                        {t.slug}
                      </td>
                      <td className="px-2 py-2 text-ink">
                        {t.isPremium ? "あり" : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/admin/members?tenantId=${t.id}`}
                          className="text-signal hover:underline"
                        >
                          {t.memberCount} 人
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-ink-soft">
                        {formatDate(t.createdAt)}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          className="text-sm text-signal hover:underline disabled:opacity-50"
                          disabled={isPending}
                          onClick={() => startEdit(t)}
                        >
                          編集
                        </button>
                      </td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
