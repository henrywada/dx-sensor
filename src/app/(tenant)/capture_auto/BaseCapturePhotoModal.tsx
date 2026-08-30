"use client";

import { Camera, X } from "lucide-react";

interface BaseCapturePhotoModalProps {
  open: boolean;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function BaseCapturePhotoModal({
  open,
  submitting,
  error,
  onCancel,
  onConfirm,
}: BaseCapturePhotoModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="base-capture-modal-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-line bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2
            id="base-capture-modal-title"
            className="flex items-center gap-2 text-base font-semibold text-ink"
          >
            <Camera className="h-4 w-4 text-signal" strokeWidth={1.75} />
            基本写真を撮る
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-ink-soft transition hover:bg-line hover:text-ink"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-4">
          <p className="text-sm leading-relaxed text-ink">
            カメラを撮影箇所に固定して撮影してください。前に登録した設定は消えます。
          </p>

          {error && (
            <p className="mt-3 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
              {error}
            </p>
          )}

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "送信中..." : "送信する"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
