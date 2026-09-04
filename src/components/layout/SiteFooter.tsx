import Link from "next/link";

export function SiteFooter({ fullWidth = false }: { fullWidth?: boolean }) {
  return (
    <footer className="border-t border-line bg-paper">
      <div
        className={`flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between ${
          fullWidth ? "w-full px-8" : "mx-auto max-w-6xl px-6"
        }`}
      >
        <div className="flex gap-4 text-xs text-ink-soft">
          <Link href="/privacy" className="hover:text-ink">
            プライバシーポリシー
          </Link>
          <Link href="/terms" className="hover:text-ink">
            利用規約
          </Link>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-soft">
          <span>© 2026 dx-sensor. All rights reserved.</span>
          <span className="font-en text-ink-soft/70">v0.1.60</span>
        </div>
      </div>
    </footer>
  );
}
