type Props = {
  /** true: レイアウト内インライン（サブメニュー Suspense 等）。false: ビューポート全体のオーバーレイ */
  embedded?: boolean;
};

/**
 * ルートセグメント・Suspense 共通の読み込み表示。
 * アイコン画像は環境差で崩れることがあるため、ブランドカラー由来の CSS アニメーションのみ使用。
 */
export function RouteSegmentLoading({ embedded = false }: Props) {
  const shell = embedded
    ? "relative flex min-h-[50vh] w-full flex-col items-center justify-center px-4 py-16 text-slate-600"
    : "fixed inset-0 z-[100] flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-hidden px-4 text-slate-600";

  return (
    <div className={shell} role="status" aria-live="polite" aria-busy="true">
      {!embedded && (
        <>
          <div
            className="pointer-events-none absolute inset-0 bg-linear-to-br from-slate-50 via-[#eef4ff] to-[#fff4ea]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            aria-hidden
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 30%, rgba(0,85,255,0.14), transparent 42%), radial-gradient(circle at 78% 65%, rgba(0,194,184,0.12), transparent 38%), radial-gradient(circle at 50% 90%, rgba(255,107,0,0.08), transparent 35%)",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.06]"
            aria-hidden
            style={{
              backgroundImage:
                "linear-gradient(rgba(0,85,255,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(0,85,255,0.2) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
        </>
      )}

      <div className="relative flex flex-col items-center gap-8">
        <div className="relative flex h-[7.25rem] w-[7.25rem] items-center justify-center">
          <div
            className="pointer-events-none absolute inset-[-18%] rounded-full bg-linear-to-tr from-[#0055ff]/35 via-[#00c2b8]/25 to-[#ff6b00]/30 blur-2xl animate-pulse"
            aria-hidden
          />
          <div
            className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-[#0055ff] border-r-[#00c2b8] opacity-90 animate-spin shadow-[0_0_20px_rgba(0,85,255,0.15)] [animation-duration:1.2s]"
            aria-hidden
          />
          <div
            className="absolute inset-[10px] rounded-full border-2 border-transparent border-b-[#ff6b00] border-l-[#0055ff] opacity-85 animate-spin [animation-duration:0.85s] [animation-direction:reverse]"
            aria-hidden
          />
          <div className="absolute inset-0 animate-spin [animation-duration:2.4s]" aria-hidden>
            <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-[#0055ff] shadow-[0_0_10px_rgba(0,85,255,0.8)]" />
          </div>
          <div
            className="absolute inset-0 animate-spin [animation-duration:3.1s] [animation-direction:reverse]"
            aria-hidden
          >
            <span className="absolute bottom-[14%] left-[14%] h-1.5 w-1.5 rounded-full bg-[#00c2b8]" />
          </div>
          <div
            className="relative h-11 w-11 rounded-full bg-linear-to-br from-[#0055ff] via-[#0088ff] to-[#00c2b8] shadow-[0_4px_24px_rgba(0,85,255,0.45)] ring-2 ring-white/80"
            aria-hidden
          >
            <span className="absolute inset-[22%] rounded-full bg-white/35 blur-[2px]" />
          </div>
        </div>

        <div className="space-y-2 text-center">
          <p className="text-sm font-semibold tracking-wide text-slate-700">
            読み込み中
          </p>
          <p className="text-xs font-medium text-slate-500">
            データを準備しています…
          </p>
        </div>
      </div>

      <span className="sr-only">読み込み中です。しばらくお待ちください。</span>
    </div>
  );
}
