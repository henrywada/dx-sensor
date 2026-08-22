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
} from "lucide-react";
import { AppCard, type AppCardProps } from "@/components/ui/AppCard";

interface AdminCategory {
  key: string;
  label: string;
  icon: typeof LayoutDashboard;
  description: string;
  apps: AppCardProps[];
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
        description: "各機能への入り口です。",
        apps: [
          {
            icon: Database,
            eyebrow: "接続状態",
            title: "Supabase接続確認",
            description: "DBへの接続とtenantsテーブルのデータを確認します。",
            href: "/debug",
          },
          {
            icon: Building2,
            eyebrow: "契約先の一覧",
            title: "テナント管理",
            description: "登録済みテナントとメンバーの一覧を確認します。",
            badge: "準備中",
          },
          {
            icon: Camera,
            eyebrow: "観測機器",
            title: "カメラ/センサー管理",
            description: "登録済みカメラの一覧と稼働状況を確認します。",
            badge: "準備中",
          },
        ],
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
            badge: "準備中",
          },
          {
            icon: Building2,
            eyebrow: "権限管理",
            title: "メンバー管理",
            description: "テナントごとのメンバーとロールを管理します。",
            badge: "準備中",
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
        apps: [
          {
            icon: Camera,
            eyebrow: "観測機器",
            title: "カメラ一覧",
            description: "登録済みカメラ(ONVIF/SoraCam)の一覧を確認します。",
            badge: "準備中",
          },
          {
            icon: KeyRound,
            eyebrow: "エージェント",
            title: "エージェントAPIキー発行",
            description: "テナント拠点のエージェント用APIキーを発行します。",
            badge: "準備中",
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

export function AdminDashboard() {
  const [selectedKey, setSelectedKey] = useState(allCategories[0].key);
  const selected = allCategories.find((c) => c.key === selectedKey) ?? allCategories[0];

  return (
    <div className="flex w-full flex-1">
      <nav className="w-72 shrink-0 space-y-4 bg-white px-4 py-4">
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
                      onClick={() => setSelectedKey(category.key)}
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

      <div className="flex-1 px-10 py-5">
        <div className="max-w-5xl">
          <h1 className="text-xl font-bold text-ink">{selected.label}</h1>
          <p className="mt-0.5 text-sm text-ink-soft">{selected.description}</p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {selected.apps.map((app) => (
              <AppCard key={app.title} {...app} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
