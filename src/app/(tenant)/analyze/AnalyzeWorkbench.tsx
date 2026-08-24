"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  VISION_PROVIDERS,
  getProviderMeta,
  type VisionProviderId,
} from "@/lib/image-analysis/providers";
import { createClient } from "@/lib/supabase/client";

interface AnalyzeWorkbenchProps {
  tenantId: string;
}

type ManualCapture = {
  id: string;
  storage_path: string;
  note: string | null;
  created_at: string;
};

type AnalysisHistoryEntry = {
  id: string;
  ranAt: Date;
  provider: VisionProviderId;
  providerLabel: string;
  prompt: string;
  status: "success" | "error";
  text?: string;
  error?: string;
  durationMs: number;
  captureIndex: number;
  captureCreatedAt: string;
};

function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}秒`;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AnalyzeWorkbench({ tenantId }: AnalyzeWorkbenchProps) {
  const supabase = createClient();

  const [captures, setCaptures] = useState<ManualCapture[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadingCaptures, setLoadingCaptures] = useState(true);
  const [loadingImage, setLoadingImage] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [provider, setProvider] = useState<VisionProviderId>("claude");
  const [prompt, setPrompt] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [history, setHistory] = useState<AnalysisHistoryEntry[]>([]);

  const providerMeta = getProviderMeta(provider);
  const currentCapture = captures[currentIndex] ?? null;

  useEffect(() => {
    let cancelled = false;

    async function loadCaptures() {
      setLoadingCaptures(true);
      setLoadError(null);

      const { data, error } = await supabase
        .from("manual_captures")
        .select("id, storage_path, note, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        setLoadError("画像一覧の取得に失敗しました");
        setCaptures([]);
      } else {
        setCaptures(data ?? []);
        setCurrentIndex(0);
      }

      setLoadingCaptures(false);
    }

    void loadCaptures();

    return () => {
      cancelled = true;
    };
  }, [supabase, tenantId]);

  const loadSignedUrl = useCallback(
    async (capture: ManualCapture) => {
      setLoadingImage(true);
      setImageUrl(null);

      const { data, error } = await supabase.storage
        .from("manual-captures")
        .createSignedUrl(capture.storage_path, 3600);

      if (error || !data?.signedUrl) {
        setLoadError("画像の読み込みに失敗しました");
        setLoadingImage(false);
        return;
      }

      setImageUrl(data.signedUrl);
      setLoadingImage(false);
    },
    [supabase]
  );

  useEffect(() => {
    if (!currentCapture) {
      setImageUrl(null);
      return;
    }

    void loadSignedUrl(currentCapture);
  }, [currentCapture, loadSignedUrl]);

  function goPrev() {
    setCurrentIndex((index) => Math.max(0, index - 1));
  }

  function goNext() {
    setCurrentIndex((index) => Math.min(captures.length - 1, index + 1));
  }

  async function handleAnalyze() {
    if (!currentCapture) return;

    if (providerMeta?.requiresPrompt && !prompt.trim()) {
      setValidationError("命令テキストを入力してください");
      return;
    }

    setValidationError(null);
    setAnalyzing(true);
    const started = performance.now();

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captureId: currentCapture.id,
          provider,
          prompt: prompt.trim(),
        }),
      });

      const data = (await res.json()) as { text?: string; error?: string };
      const durationMs = performance.now() - started;
      const label = getProviderMeta(provider)?.label ?? provider;

      const entry: AnalysisHistoryEntry = {
        id: crypto.randomUUID(),
        ranAt: new Date(),
        provider,
        providerLabel: label,
        prompt: prompt.trim(),
        durationMs,
        captureIndex: currentIndex,
        captureCreatedAt: currentCapture.created_at,
        status: res.ok ? "success" : "error",
        ...(res.ok
          ? { text: data.text ?? "" }
          : { error: data.error ?? "解析に失敗しました" }),
      };

      setHistory((prev) => [entry, ...prev]);
    } catch {
      const durationMs = performance.now() - started;
      const label = getProviderMeta(provider)?.label ?? provider;

      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          ranAt: new Date(),
          provider,
          providerLabel: label,
          prompt: prompt.trim(),
          durationMs,
          captureIndex: currentIndex,
          captureCreatedAt: currentCapture.created_at,
          status: "error",
          error: "通信エラーが発生しました",
        },
        ...prev,
      ]);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-lg font-semibold text-ink">画像解析</h1>
      <p className="mt-1 text-sm text-ink-soft">
        保存済みの画像にAI解析を実行し、命令に応じた結果を確認します。
      </p>

      <section className="mt-8 space-y-3">
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          <div className="relative flex aspect-video items-center justify-center bg-paper">
            {loadingCaptures || loadingImage ? (
              <p className="text-sm text-ink-soft">読み込み中...</p>
            ) : imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt="解析対象の画像"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <p className="px-4 text-center text-sm text-ink-soft">
                {loadError ?? "表示する画像がありません"}
              </p>
            )}
          </div>
        </div>

        {captures.length > 0 && (
          <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goPrev}
                disabled={currentIndex === 0}
                aria-label="前の画像"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-ink transition hover:border-signal/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="min-w-[5rem] text-center text-sm tabular-nums text-ink">
                {currentIndex + 1} / {captures.length}
              </span>
              <button
                type="button"
                onClick={goNext}
                disabled={currentIndex >= captures.length - 1}
                aria-label="次の画像"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-line bg-white text-ink transition hover:border-signal/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {currentCapture && (
              <p className="text-center text-xs text-ink-soft sm:text-right">
                {formatTimestamp(currentCapture.created_at)}
                {currentCapture.note ? ` · ${currentCapture.note}` : ""}
              </p>
            )}
          </div>
        )}

        {!loadingCaptures && captures.length === 0 && (
          <p className="text-sm text-ink-soft">
            画像がありません。{" "}
            <Link href="/capture" className="font-medium text-signal underline-offset-2 hover:underline">
              手動撮影アップロード
            </Link>
            から追加してください。
          </p>
        )}
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">解析TOOL</h2>
        <fieldset className="space-y-2">
          <legend className="sr-only">使用する画像解析TOOL</legend>
          {VISION_PROVIDERS.map((item) => (
            <label
              key={item.id}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-3 py-2 transition hover:border-signal/40 has-[:checked]:border-signal has-[:checked]:bg-signal-soft/30"
            >
              <input
                type="radio"
                name="vision-provider"
                value={item.id}
                checked={provider === item.id}
                onChange={() => setProvider(item.id)}
                className="accent-signal"
              />
              <span className="text-sm text-ink">{item.label}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">命令テキスト</h2>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!providerMeta?.requiresPrompt || analyzing}
          rows={4}
          placeholder={
            providerMeta?.requiresPrompt
              ? "例: この画像に写っている物体を列挙してください"
              : "この解析TOOLでは命令テキストは不要です"
          }
          className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:bg-line/20 disabled:text-ink-soft"
        />
        {validationError && (
          <p className="text-sm text-alert">{validationError}</p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleAnalyze()}
            disabled={analyzing || !currentCapture}
            className="rounded-md bg-signal px-5 py-2 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analyzing ? "解析中..." : "実行"}
          </button>
        </div>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">結果</h2>
        {history.length === 0 ? (
          <p className="text-sm text-ink-soft">実行結果がここに表示されます。</p>
        ) : (
          <ul className="space-y-3">
            {history.map((entry) => (
              <li
                key={entry.id}
                className={`rounded-lg border bg-white p-4 ${
                  entry.status === "error" ? "border-alert/30" : "border-line"
                }`}
              >
                <p className="text-xs text-ink-soft">
                  {entry.ranAt.toLocaleString("ja-JP")} · {entry.providerLabel} · 所要時間{" "}
                  {formatDuration(entry.durationMs)}
                  {entry.status === "error" ? " · エラー" : ""}
                </p>
                <p className="mt-1 text-xs text-ink-soft/80">
                  画像 {entry.captureIndex + 1}（{formatTimestamp(entry.captureCreatedAt)}）
                </p>
                {entry.prompt && (
                  <p className="mt-2 text-sm text-ink">
                    <span className="font-medium">命令:</span> {entry.prompt}
                  </p>
                )}
                {entry.status === "success" ? (
                  <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
                    {entry.text}
                  </pre>
                ) : (
                  <p className="mt-2 text-sm text-alert">{entry.error}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
