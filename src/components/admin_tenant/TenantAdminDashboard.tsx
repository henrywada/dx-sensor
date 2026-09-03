"use client";

import { useState } from "react";
import {
  LayoutDashboard,
  UserPlus,
  MessageCircle,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { AppCard, type AppCardProps } from "@/components/ui/AppCard";

interface TenantAdminCategory {
  key: string;
  label: string;
  icon: typeof LayoutDashboard;
  description: string;
  apps: AppCardProps[];
}

interface TenantAdminGroup {
  label: string;
  categories: TenantAdminCategory[];
}

const groups: TenantAdminGroup[] = [
  {
    label: "概要",
    categories: [
      {
        key: "dashboard",
        label: "ダッシュボード",
        icon: LayoutDashboard,
        description: "テナントの利用状況を確認します。",
        apps: [],
      },
    ],
  },
  {
    label: "メンバー",
    categories: [
      {
        key: "user-registration",
        label: "ユーザ登録",
        icon: UserPlus,
        description: "テナントに所属するユーザーの登録方法を選びます。",
        apps: [
          {
            icon: MessageCircle,
            eyebrow: "LINE連携",
            title: "LINE登録",
            description: "LINE公式アカウントの友だち追加からユーザーを登録します。",
            href: "/members/friend-invites",
          },
        ],
      },
    ],
  },
];

const allCategories = groups.flatMap((g) => g.categories);

export function TenantAdminDashboard() {
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
        id="admin-tenant-nav"
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
          aria-controls="admin-tenant-nav"
        >
          <Menu className="h-4 w-4" strokeWidth={1.75} />
          メニュー
        </button>
        <div className="max-w-5xl">
          <h1 className="text-xl font-bold text-ink">{selected.label}</h1>
          <p className="mt-0.5 text-sm text-ink-soft">{selected.description}</p>

          {!isDashboard && (
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
