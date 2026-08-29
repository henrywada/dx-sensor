export function SiteFooter({ fullWidth = false }: { fullWidth?: boolean }) {
  return (
    <footer className="border-t border-line bg-paper">
      <div
        className={`flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between ${
          fullWidth ? "w-full px-8" : "mx-auto max-w-6xl px-6"
        }`}
      >
        <div className="flex gap-4 text-xs text-ink-soft">
          <a href="#" className="hover:text-ink">
            プライバシーポリシー
          </a>
          <a href="#" className="hover:text-ink">
            利用規約
          </a>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-soft">
          <span>© 2026 dx-sensor. All rights reserved.</span>
          <span className="font-en text-ink-soft/70">v0.1.42</span>
        </div>
      </div>
    </footer>
  );
}
