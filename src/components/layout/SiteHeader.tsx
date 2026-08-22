import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { LogoMark } from "@/components/ui/LogoMark";
import { LogoutButton } from "@/components/layout/LogoutButton";

interface SiteHeaderProps {
  isDeveloper: boolean;
  email: string | null;
}

export function SiteHeader({ isDeveloper, email }: SiteHeaderProps) {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5 text-ink">
          <LogoMark className="h-6 w-6 text-signal" />
          <span className="text-lg font-bold tracking-tight">
            dx-sensor
          </span>
        </Link>

        <div className="flex items-center gap-4">
          {isDeveloper && (
            <Link
              href="/admin"
              className="flex items-center gap-1.5 rounded-full border border-alert/40 bg-alert-soft px-4 py-1.5 text-sm font-medium text-alert transition-colors hover:border-alert"
            >
              <ShieldCheck className="h-4 w-4" strokeWidth={2} />
              管理へ
            </Link>
          )}
          {email && (
            <span className="hidden font-en text-xs text-ink-soft sm:inline">
              {email}
            </span>
          )}
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
