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
      <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-lg border border-line bg-white shadow-lg">
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

          <div className="mt-4">
            <p className="font-semibold text-ink">【手順】</p>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-ink">
              <li>カメラを監視する対象に合わせて固定する。（三脚等で固定）</li>
              <li>「基本写真を撮る」ボタンを押し、「送信する」ボタンを押す。</li>
              <li>
                PCでdx-sensorを起動し、「監視分析を見る」を起動し「監視ゾーンの設定」で監視ゾーンを囲む。
                解析精度を上げる為、AIは「監視ゾーン」で囲んだ部分に焦点を当てて変化を観測します。
              </li>
              <li>
                「監視条件の設定」：何を、どのように監視したいかの事前知識をAIに教えます。
                AIは、監視条件に従って変化を考察します。
              </li>
              <li>「監視状況」：2枚の写真を比較し解析している状況を表示します。</li>
              <li>「アクティブ履歴」：解析結果のログを表示。</li>
              <li>「画像表示」：スマホのカメラで撮った画像が表示されます。</li>
            </ol>
          </div>

          <hr className="my-4 border-line" />

          <p className="font-semibold text-ink">【固定撮影】</p>

          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-ink">
            <li>
              「自動撮影開始」で間隔ごとに取得＆保存を開始し、「停止」で終了します。
            </li>
            <li>
              カメラ枠のサイズは常に縦長です。「設置向き」は保存時の回転だけに使います。
              横置きはスマホを左に傾けて固定するのが標準です。右に傾けた場合や向きがずれるときは
              「回転方向を反転」をオンにして撮り直してください。
            </li>
            <li>この画面を開くと、前回保存した自分の定点監視画像は削除されます。</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
