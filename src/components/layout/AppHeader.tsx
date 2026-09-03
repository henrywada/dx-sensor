import Link from "next/link";
import { ShieldCheck, Settings, ArrowLeftCircle } from "lucide-react";
import { LogoMark } from "@/components/ui/LogoMark";
import { LogoutButton } from "@/components/layout/LogoutButton";
import type { ActiveTenant } from "@/lib/auth/getActiveTenant";

interface AppHeaderProps {
  variant: "tenant" | "admin";
  isDeveloper?: boolean;
  // ActiveTenant["role"] doesn't (yet) include "admin_tenant" in this
  // branch's committed baseline; widened locally so the admin_tenant nav
  // check below type-checks without touching the shared interface (which
  // has unrelated, currently-uncommitted, in-flight changes on main).
  tenantRole?: ActiveTenant["role"] | "admin_tenant";
  email?: string | null;
  // LINEアプリ内蔵ブラウザ(LIFF)経由のアクセスではログアウトボタンを隠す。
  // ログアウトしてもLINE側のログイン状態は残り続けるため実害はないが、
  // LINEユーザーにメール/パスワードのログイン画面が突然出る不自然な体験になるため。
  hideLogoutButton?: boolean;
}

/**
 * Single shared header for both / (tenant) and /admin. Previously these
 * were two separate components (SiteHeader / AdminHeader) which risked
 * drifting apart (e.g. footer version display, spacing, button styles
 * living in two places that had to be kept in sync manually). Now there
 * is exactly one place that defines the header.
 */
export function AppHeader({
  variant,
  isDeveloper = false,
  tenantRole,
  email = null,
  hideLogoutButton = false,
}: AppHeaderProps) {
  const isAdmin = variant === "admin";
  const canAccessTenantAdmin = isDeveloper || tenantRole === "admin_tenant";

  return (
    <header className="border-b border-line bg-paper">
      <div className="flex w-full items-center justify-between gap-2 px-4 py-3 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          <LogoMark className={`h-6 w-6 ${isAdmin ? "text-alert" : "text-signal"}`} />
          <span className="text-lg font-bold tracking-tight">
            dx-sensor {isAdmin && <span className="text-alert">管理画面</span>}
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {isAdmin ? (
            <>
              {canAccessTenantAdmin && (
                <Link
                  href="/admin_tenant"
                  className="flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:border-emerald-400 sm:px-4"
                >
                  <Settings className="h-4 w-4" strokeWidth={2} />
                  管理へ
                </Link>
              )}
              {!hideLogoutButton && <LogoutButton />}
              <Link
                href="/"
                className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-signal hover:text-signal sm:px-4"
              >
                <ArrowLeftCircle className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span className="sm:hidden">ユーザへ</span>
                <span className="hidden sm:inline">ユーザ画面へ</span>
              </Link>
            </>
          ) : (
            <>
              {canAccessTenantAdmin && (
                <Link
                  href="/admin_tenant"
                  className="flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:border-emerald-400 sm:px-4"
                >
                  <Settings className="h-4 w-4" strokeWidth={2} />
                  管理へ
                </Link>
              )}
              {isDeveloper && (
                <Link
                  href="/admin"
                  className="flex items-center gap-1.5 rounded-full border border-alert/40 bg-alert-soft px-4 py-1.5 text-sm font-medium text-alert transition-colors hover:border-alert"
                >
                  <ShieldCheck className="h-4 w-4" strokeWidth={2} />
                  開発管理へ
                </Link>
              )}
              {email && <span className="hidden font-en text-xs text-ink-soft sm:inline">{email}</span>}
              {!hideLogoutButton && <LogoutButton />}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
