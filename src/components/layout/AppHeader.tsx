import Link from "next/link";
import { ShieldCheck, ArrowLeftCircle } from "lucide-react";
import { LogoMark } from "@/components/ui/LogoMark";
import { LogoutButton } from "@/components/layout/LogoutButton";

interface AppHeaderProps {
  variant: "tenant" | "admin";
  isDeveloper?: boolean;
  email?: string | null;
}

/**
 * Single shared header for both / (tenant) and /admin. Previously these
 * were two separate components (SiteHeader / AdminHeader) which risked
 * drifting apart (e.g. footer version display, spacing, button styles
 * living in two places that had to be kept in sync manually). Now there
 * is exactly one place that defines the header.
 */
export function AppHeader({ variant, isDeveloper = false, email = null }: AppHeaderProps) {
  const isAdmin = variant === "admin";

  return (
    <header className="border-b border-line bg-paper">
      <div className="flex w-full items-center justify-between px-8 py-3">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          <LogoMark className={`h-6 w-6 ${isAdmin ? "text-alert" : "text-signal"}`} />
          <span className="text-lg font-bold tracking-tight">
            dx-sensor {isAdmin && <span className="text-alert">管理画面</span>}
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {isAdmin ? (
            <>
              <LogoutButton />
              <Link
                href="/"
                className="flex items-center gap-1.5 rounded-full border border-line px-4 py-1.5 text-sm font-medium text-ink transition-colors hover:border-signal hover:text-signal"
              >
                <ArrowLeftCircle className="h-4 w-4" strokeWidth={2} />
                テナント画面へ
              </Link>
            </>
          ) : (
            <>
              {isDeveloper && (
                <Link
                  href="/admin"
                  className="flex items-center gap-1.5 rounded-full border border-alert/40 bg-alert-soft px-4 py-1.5 text-sm font-medium text-alert transition-colors hover:border-alert"
                >
                  <ShieldCheck className="h-4 w-4" strokeWidth={2} />
                  管理へ
                </Link>
              )}
              {email && <span className="hidden font-en text-xs text-ink-soft sm:inline">{email}</span>}
              <LogoutButton />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
