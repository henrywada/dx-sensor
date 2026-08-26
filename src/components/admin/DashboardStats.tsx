"use client";

import type { DashboardStats } from "@/lib/admin/getDashboardStats";
import { formatCostYen } from "@/lib/image-analysis/estimateCostYen";
import { CurvedLineChart } from "./CurvedLineChart";
import { DailyBarChart } from "./DailyBarChart";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type DashboardStatsProps = {
  stats: DashboardStats;
};

export function DashboardStatsView({ stats }: DashboardStatsProps) {
  return (
    <div className="mt-6 space-y-10">
      <section>
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
            ユーザ情報
          </h2>
          <p className="text-sm text-ink-soft">
            ユーザ数{" "}
            <span className="font-en text-2xl font-semibold text-ink">
              {stats.userCount}
            </span>
          </p>
        </div>

        <div className="mt-3 overflow-x-auto rounded-md border border-line bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line bg-paper text-ink-soft">
              <tr>
                <th className="px-3 py-2 font-medium">メールアドレス</th>
                <th className="px-3 py-2 font-medium">作成日</th>
                <th className="px-3 py-2 font-medium">最終ログイン</th>
              </tr>
            </thead>
            <tbody>
              {stats.users.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-ink-soft">
                    ユーザーがいません。
                  </td>
                </tr>
              )}
              {stats.users.map((user) => (
                <tr key={user.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 text-ink">{user.email || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-soft">
                    {formatDateTime(user.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-soft">
                    {user.lastSignInAt ? formatDateTime(user.lastSignInAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
            画像解析APIコスト（直近30日・日別・概算）
          </h2>
          <p className="text-sm text-ink-soft">
            期間合計{" "}
            <span className="font-en text-2xl font-semibold text-ink">
              {formatCostYen(stats.analysisCostTotalYen)}
            </span>
          </p>
        </div>
        <div className="mt-3 rounded-md border border-line bg-white p-4">
          <p className="text-xs text-ink-soft">
            Gemini / Claude / GPT / Plate Recognizer 等の実行ログ合計（円）
          </p>
          <div className="mt-3">
            <DailyBarChart data={stats.analysisCost} fill="#0055ff" />
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
          アクセス状況（直近30日・日別）
        </h2>

        <div className="rounded-md border border-line bg-white p-4">
          <h3 className="text-sm font-semibold text-ink">全体</h3>
          <p className="mt-0.5 text-xs text-ink-soft">
            スマホ監視カメラ + 写真保存
          </p>
          <div className="mt-3">
            <CurvedLineChart data={stats.overall} stroke="#0e7c86" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-line bg-white p-4">
            <h3 className="text-sm font-semibold text-ink">スマホ監視カメラ</h3>
            <p className="mt-0.5 text-xs text-ink-soft">manual_captures 日別件数</p>
            <div className="mt-3">
              <CurvedLineChart data={stats.monitorCamera} stroke="#0e7c86" />
            </div>
          </div>
          <div className="rounded-md border border-line bg-white p-4">
            <h3 className="text-sm font-semibold text-ink">写真保存</h3>
            <p className="mt-0.5 text-xs text-ink-soft">picture_sends 日別件数</p>
            <div className="mt-3">
              <CurvedLineChart data={stats.pictureSave} stroke="#c45c26" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
