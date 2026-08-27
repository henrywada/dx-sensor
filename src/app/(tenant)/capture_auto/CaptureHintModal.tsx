"use client";

import { HelpCircle, X } from "lucide-react";

interface CaptureHintModalProps {
  open: boolean;
  onClose: () => void;
}

export function CaptureHintModal({ open, onClose }: CaptureHintModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="capture-hint-modal-title"
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-lg border border-line bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2
            id="capture-hint-modal-title"
            className="flex items-center gap-2 text-base font-semibold text-ink"
          >
            <HelpCircle className="h-4 w-4 text-signal" strokeWidth={1.75} />
            ヒント
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-soft transition hover:bg-line hover:text-ink"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[calc(85vh-4rem)] overflow-y-auto px-4 py-4">
          <p className="font-bold text-alert">
            スマホを固定して撮影してください。
            <br />
            （微妙なブレ、影とかも変化として捉えてしまいます）
          </p>

          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-ink">
            <li>
              「自動撮影開始」で間隔ごとに取得＆保存を開始し、「停止」で終了します。
            </li>
            <li>この画面を開くと、前回保存した自分の定点監視画像は削除されます。</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
