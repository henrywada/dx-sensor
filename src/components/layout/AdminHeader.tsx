import Link from "next/link";
import { ArrowLeftCircle } from "lucide-react";
import { LogoMark } from "@/components/ui/LogoMark";
import { LogoutButton } from "@/components/layout/LogoutButton";

export function AdminHeader() {
  return (
    <header className="border-b border-line bg-paper">
      <div className="flex w-full items-center justify-between px-8 py-3">
        <div className="flex items-center gap-2.5 text-ink">
          <LogoMark className="h-6 w-6 text-alert" />
          <span className="text-lg font-bold tracking-tight">
            dx-sensor <span className="text-alert">管理画面</span>
          </span>
        </div>

        <div className="flex items-center gap-3">
          <LogoutButton />
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-full border border-line px-4 py-1.5 text-sm font-medium text-ink transition-colors hover:border-signal hover:text-signal"
          >
            <ArrowLeftCircle className="h-4 w-4" strokeWidth={2} />
            テナント画面へ
          </Link>
        </div>
      </div>
    </header>
  );
}
