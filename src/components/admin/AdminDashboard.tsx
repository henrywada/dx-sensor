"use client";

import { useState } from "react";
import {
  LayoutDashboard,
  Building2,
  Camera,
  Database,
  Settings,
  KeyRound,
  ChevronRight,
  Upload,
  Sparkles,
  Menu,
  X,
} from "lucide-react";
import { AppCard, type AppCardProps } from "@/components/ui/AppCard";
import type { DashboardStats } from "@/lib/admin/getDashboardStats";
import { DashboardStatsView } from "./DashboardStats";

interface AdminAppSection {
  label: string;
  apps: AppCardProps[];
}

interface AdminCategory {
  key: string;
  label: string;
  icon: typeof LayoutDashboard;
  description: string;
  apps: AppCardProps[];
  /** Optional subsections (e.g. スマホカメラ / その他). When set, preferred over flat apps. */
  sections?: AdminAppSection[];
}

interface AdminGroup {
  label: string;
  categories: AdminCategory[];
}

const groups: AdminGroup[] = [
  {
    label: "概要",
    categories: [
      {
        key: "dashboard",
        label: "ダッシュボード",
        icon: LayoutDashboard,
        description: "ユーザーとサービスの利用状況を確認します。",
        apps: [],
      },
    ],
  },
  {
    label: "テナント",
    categories: [
      {
        key: "tenants",
        label: "テナント管理",
        icon: Building2,
        description: "契約先ごとの情報とメンバーを管理します。",
        apps: [
          {
            icon: Building2,
            eyebrow: "契約先",
            title: "テナント一覧",
            description: "登録済みテナントの一覧・詳細を確認します。",
            href: "/admin/tenants",
          },
          {
            icon: Building2,
            eyebrow: "権限管理",
            title: "メンバー管理",
            description: "テナントごとのメンバーとロールを管理します。",
            href: "/admin/members",
          },
        ],
      },
    ],
  },
  {
    label: "センサー",
    categories: [
      {
        key: "sensors",
        label: "カメラ/センサー管理",
        icon: Camera,
        description: "観測に使用する機器の登録・認証情報を管理します。",
        apps: [],
        sections: [
          {
            label: "スマホカメラ",
            apps: [
              {
                icon: Upload,
                title: "手動撮影アップロード",
                description: "スマホのカメラで撮影した写真をその場でアップロードします。",
                href: "/admin/capture",
              },
              {
                icon: Sparkles,
                title: "画像解析",
                description: "保存済みの画像にAI解析を実行し、命令に応じた結果を確認します。",
                href: "/admin/analyze",
              },
            ],
          },
          {
            label: "その他",
            apps: [
              {
                icon: Camera,
                title: "カメラ一覧",
                description: "登録済みカメラ(ONVIF/SoraCam)の一覧を確認します。",
                badge: "準備中",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    label: "データ",
    categories: [
      {
        key: "data",
        label: "データ確認",
        icon: Database,
        description: "取得済みの観測データを確認します。",
        apps: [
          {
            icon: Database,
            eyebrow: "接続状態",
            title: "Supabase接続確認",
            description: "DBへの接続とtenantsテーブルのデータを確認します。",
            href: "/debug",
          },
          {
            icon: Database,
            eyebrow: "観測記録",
            title: "観測イベント一覧",
            description: "取得済みの観測データ(vehicle_events等)を確認します。",
            badge: "準備中",
          },
        ],
      },
    ],
  },
  {
    label: "システム",
    categories: [
      {
        key: "system",
        label: "システム設定",
        icon: Settings,
        description: "認証情報や全体設定を管理します。",
        apps: [
          {
            icon: KeyRound,
            eyebrow: "エージェント",
            title: "エージェントAPIキー発行",
            description: "テナント拠点のエージェント用APIキーを発行します。",
            badge: "準備中",
          },
          {
            icon: KeyRound,
            eyebrow: "認証情報",
            title: "シークレット管理",
            description: "Vaultに保存された認証情報の一覧・ローテーションを行います。",
            badge: "準備中",
          },
        ],
      },
    ],
  },
];

const allCategories = groups.flatMap((g) => g.categories);

type AdminDashboardProps = {
  stats: DashboardStats;
  statsError?: string | null;
};

export function AdminDashboard({ stats, statsError = null }: AdminDashboardProps) {
  const [selectedKey, setSelectedKey] = useState(allCategories[0].key);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const selected = allCategories.find((c) => c.key === selectedKey) ?? allCategories[0];
  const isDashboard = selected.key === "dashboard";

  function selectCategory(key: string) {
    setSelectedKey(key);
    setMobileNavOpen(false);
  }

  return (
    <div className="relative flex w-full min-w-0 flex-1">
      {mobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-label="メニューを閉じる"
        />
      )}

      <nav
        id="admin-nav"
        className={`fixed bottom-0 left-0 top-14 z-50 w-72 max-w-[85vw] shrink-0 space-y-4 overflow-y-auto border-r border-line bg-white px-4 py-4 transition-transform duration-200 md:static md:top-auto md:z-auto md:max-w-none md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${!mobileNavOpen ? "pointer-events-none md:pointer-events-auto" : ""}`}
      >
        <div className="mb-2 flex items-center justify-between md:hidden">
          <p className="text-sm font-semibold text-ink">メニュー</p>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-md p-1 text-ink-soft hover:bg-line/40 hover:text-ink"
            aria-label="メニューを閉じる"
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
        {groups.map((group, index) => (
          <div key={group.label} className={index > 0 ? "border-t border-line pt-4" : ""}>
            <p className="mb-1 px-2.5 text-xs font-semibold text-ink-soft/70">{group.label}</p>
            <ul className="space-y-px">
              {group.categories.map((category) => {
                const Icon = category.icon;
                const active = category.key === selectedKey;
                return (
                  <li key={category.key}>
                    <button
                      type="button"
                      onClick={() => selectCategory(category.key)}
                      className={`flex w-full items-center gap-2 rounded-md border-l-2 px-2.5 py-1.5 text-left text-sm transition-colors ${
                        active
                          ? "border-signal bg-signal-soft font-medium text-signal"
                          : "border-transparent text-ink-soft hover:bg-line/40 hover:text-ink"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                      <span className="flex-1">{category.label}</span>
                      {active && <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={2} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="min-w-0 flex-1 px-4 py-4 md:px-10 md:py-5">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="mb-3 inline-flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-signal hover:text-signal md:hidden"
          aria-expanded={mobileNavOpen}
          aria-controls="admin-nav"
        >
          <Menu className="h-4 w-4" strokeWidth={1.75} />
          メニュー
        </button>
        <div className="max-w-5xl">
          <h1 className="text-xl font-bold text-ink">{selected.label}</h1>
          <p className="mt-0.5 text-sm text-ink-soft">{selected.description}</p>

          {isDashboard ? (
            statsError ? (
              <p className="mt-6 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
                ダッシュボードの読み込みに失敗しました: {statsError}
              </p>
            ) : (
              <DashboardStatsView stats={stats} />
            )
          ) : selected.sections && selected.sections.length > 0 ? (
            <div className="mt-6 space-y-8">
              {selected.sections.map((section) => (
                <section key={section.label}>
                  <h2 className="mb-3 text-sm font-bold tracking-wide text-ink-soft">
                    {section.label}
                  </h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {section.apps.map((app) => (
                      <AppCard key={app.title} {...app} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {selected.apps.map((app) => (
                <AppCard key={app.title} {...app} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
