"use client";

type DocumentImagePreviewOverlayProps = {
  image: { url: string; label: string } | null;
  onClose: () => void;
};

export function DocumentImagePreviewOverlay({
  image,
  onClose,
}: DocumentImagePreviewOverlayProps) {
  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${image.label}の拡大表示`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(92vh,900px)] w-full max-w-4xl flex-col rounded-lg border border-line bg-white shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{image.label}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-signal hover:text-ink"
          >
            閉じる
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={image.label}
            className="mx-auto max-h-[75vh] w-auto max-w-full object-contain"
          />
        </div>
      </div>
    </div>
  );
}
