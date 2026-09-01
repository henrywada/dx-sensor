"use client";

import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  captureFrameFromVideo,
  type MountOrientation,
} from "@/lib/capture/captureFrameFromVideo";
import { CaptureHintModal } from "./CaptureHintModal";
import { BaseCapturePhotoModal } from "./BaseCapturePhotoModal";

interface CaptureAutoFormProps {
  tenantId: string;
  userId: string;
}

type CameraState = "starting" | "ready" | "denied" | "unsupported" | "error";
type UploadStatus = "idle" | "uploading" | "done" | "error";

const INTERVAL_OPTIONS_SEC = [5, 10, 15, 20, 30, 60, 120, 180] as const;
const MOUNT_STORAGE_KEY = "dx-sensor.capture-auto.mount";
const INVERT_STORAGE_KEY = "dx-sensor.capture-auto.invert-rotation";

function readStoredMount(): MountOrientation {
  if (typeof window === "undefined") return "landscape";
  const stored = window.localStorage.getItem(MOUNT_STORAGE_KEY);
  return stored === "portrait" ? "portrait" : "landscape";
}

function readStoredInvert(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(INVERT_STORAGE_KEY) === "1";
}

export function CaptureAutoForm({ tenantId, userId }: CaptureAutoFormProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadingRef = useRef(false);
  const cameraReadyRef = useRef(false);
  const supabase = useMemo(() => createClient(), []);
  const startGenerationRef = useRef(0);

  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [intervalSec, setIntervalSec] = useState<number>(5);
  const [autoRunning, setAutoRunning] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [clearWarning, setClearWarning] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [baseCaptureModalOpen, setBaseCaptureModalOpen] = useState(false);
  const [baseCaptureSubmitting, setBaseCaptureSubmitting] = useState(false);
  const [baseCaptureError, setBaseCaptureError] = useState<string | null>(null);
  const [mountOrientation, setMountOrientation] = useState<MountOrientation>("landscape");
  const [invertRotation, setInvertRotation] = useState(false);

  const clearOwnAutoCaptures = useCallback(async () => {
    setClearWarning(null);
    try {
      // 「前のイベント履歴」（session_id is null の、まだ履歴ファイルとして
      // 保存されていない現在のmonitor_change_events）と「画像」(auto_captures)
      // をまとめてクリアする。DB関数側でイベント削除→画像削除の順に単一トランザクションで
      // 実行し、「履歴ファイル」（session_id付きのアーカイブ済み履歴）が参照している
      // 画像だけは保護する（clear_own_auto_captures_and_events、
      // 20260831120000マイグレーション参照）。RLS(auto_captures_delete_own /
      // monitor_change_events_delete_own)はこの関数内でもそのまま効く。
      const { data: deletedRows, error: rpcError } = await supabase.rpc(
        "clear_own_auto_captures_and_events",
        { p_tenant_id: tenantId, p_user_id: userId }
      );

      if (rpcError) throw rpcError;

      const paths = ((deletedRows ?? []) as { storage_path: string | null }[])
        .map((row) => row.storage_path)
        .filter((p): p is string => Boolean(p));

      if (paths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from("auto-captures")
          .remove(paths);
        if (storageError) throw storageError;
      }
    } catch (err) {
      console.error("clearOwnAutoCaptures failed", err);
      setClearWarning(
        err instanceof Error
          ? `前回データの削除に失敗しました: ${err.message}`
          : "前回データの削除に失敗しました"
      );
    }
  }, [supabase, tenantId, userId]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    cameraReadyRef.current = false;
  }, []);

  const startCamera = useCallback(async () => {
    const generation = ++startGenerationRef.current;
    setCameraState("starting");
    setCameraError(null);
    cameraReadyRef.current = false;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      setCameraError(
        "このブラウザではカメラAPIを利用できません。HTTPSで開いているか確認してください。"
      );
      return;
    }

    stopCamera();

    const isStale = () => generation !== startGenerationRef.current;

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch (primaryErr) {
        console.warn("getUserMedia primary constraints failed, retrying simple", primaryErr);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: true,
        });
      }

      if (isStale()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setCameraState("error");
        setCameraError("映像要素を初期化できませんでした。再試行してください。");
        return;
      }

      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      try {
        await video.play();
      } catch (playErr) {
        console.warn("video.play() failed once, retrying", playErr);
        await new Promise((resolve) => window.setTimeout(resolve, 150));
        if (isStale()) return;
        await video.play();
      }

      if (isStale()) return;

      cameraReadyRef.current = true;
      setCameraState("ready");
    } catch (err) {
      if (isStale()) return;
      console.error("getUserMedia failed", err);
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setCameraState("denied");
        setCameraError("カメラの使用が拒否されました。ブラウザの設定で許可してください。");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setCameraState("error");
        setCameraError("利用可能なカメラが見つかりませんでした。");
      } else {
        setCameraState("error");
        setCameraError(
          err instanceof Error ? err.message : "カメラの起動に失敗しました"
        );
      }
    }
  }, [stopCamera]);

  useEffect(() => {
    setMountOrientation(readStoredMount());
    setInvertRotation(readStoredInvert());
  }, []);

  useEffect(() => {
    window.localStorage.setItem(MOUNT_STORAGE_KEY, mountOrientation);
  }, [mountOrientation]);

  useEffect(() => {
    window.localStorage.setItem(INVERT_STORAGE_KEY, invertRotation ? "1" : "0");
  }, [invertRotation]);

  // Clear previous captures in the background — never block camera startup.
  useEffect(() => {
    void clearOwnAutoCaptures();
  }, [clearOwnAutoCaptures]);

  useEffect(() => {
    void startCamera();
    return () => {
      startGenerationRef.current += 1;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const captureAndUpload = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !cameraReadyRef.current || uploadingRef.current) return false;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      setUploadStatus("error");
      setUploadError("映像の準備ができていません。少し待ってから再度お試しください。");
      return false;
    }

    uploadingRef.current = true;
    setUploadStatus("uploading");
    setUploadError(null);

    try {
      const canvas = captureFrameFromVideo(video, mountOrientation, invertRotation);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error("画像の生成に失敗しました"));
          },
          "image/jpeg",
          0.92
        );
      });

      const dateSegment = new Date().toISOString().slice(0, 10);
      const path = `${tenantId}/${dateSegment}/${crypto.randomUUID()}.jpg`;

      const { error: uploadErrorResult } = await supabase.storage
        .from("auto-captures")
        .upload(path, blob, { contentType: "image/jpeg" });

      if (uploadErrorResult) throw uploadErrorResult;

      const { error: insertError } = await supabase.from("auto_captures").insert({
        tenant_id: tenantId,
        captured_by: userId,
        storage_path: path,
      });

      if (insertError) throw insertError;

      setUploadStatus("done");
      setSavedCount((n) => n + 1);
      setLastSavedAt(new Date());
      return true;
    } catch (err) {
      console.error("capture_auto upload failed", err);
      setUploadStatus("error");
      setUploadError(
        err instanceof Error ? err.message : "アップロードに失敗しました"
      );
      return false;
    } finally {
      uploadingRef.current = false;
    }
  }, [supabase, tenantId, userId, mountOrientation, invertRotation]);

  const handleConfirmBaseCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !cameraReadyRef.current) {
      setBaseCaptureError("カメラの準備ができていません。少し待ってから再度お試しください。");
      return;
    }

    setBaseCaptureSubmitting(true);
    setBaseCaptureError(null);

    try {
      const canvas = captureFrameFromVideo(video, mountOrientation, invertRotation);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error("画像の生成に失敗しました"));
          },
          "image/jpeg",
          0.92
        );
      });

      // 前に登録した基本写真（と、それにひも付く監視ゾーン）を削除する。
      // monitor_zones は base_photo_id に on delete cascade を張っているため、
      // ここで基本写真の行を消せば監視ゾーンも自動的に消える。
      const { data: existingRows, error: selectError } = await supabase
        .from("monitor_base_photos")
        .select("id, storage_path")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId);
      if (selectError) throw selectError;

      if (existingRows && existingRows.length > 0) {
        const paths = existingRows
          .map((row) => row.storage_path as string)
          .filter((p) => Boolean(p));
        if (paths.length > 0) {
          const { error: removeError } = await supabase.storage
            .from("auto-captures")
            .remove(paths);
          if (removeError) throw removeError;
        }
        const { error: deleteError } = await supabase
          .from("monitor_base_photos")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("user_id", userId);
        if (deleteError) throw deleteError;
      }

      const path = `${tenantId}/base/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("auto-captures")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("monitor_base_photos").insert({
        tenant_id: tenantId,
        user_id: userId,
        storage_path: path,
      });
      if (insertError) throw insertError;

      setBaseCaptureModalOpen(false);
    } catch (err) {
      console.error("base photo capture failed", err);
      setBaseCaptureError(
        err instanceof Error ? err.message : "基本写真の登録に失敗しました"
      );
    } finally {
      setBaseCaptureSubmitting(false);
    }
  }, [supabase, tenantId, userId, mountOrientation, invertRotation]);

  // 自動撮影開始後のみ、間隔ごとに取得＆保存（開始前はプレビュー表示のみ）
  useEffect(() => {
    if (!autoRunning || cameraState !== "ready") return;

    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      void captureAndUpload();
    };

    tick();
    const timerId = window.setInterval(tick, intervalSec * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [autoRunning, cameraState, intervalSec, captureAndUpload]);

  useEffect(() => {
    if (cameraState !== "ready" && autoRunning) {
      setAutoRunning(false);
    }
  }, [cameraState, autoRunning]);

  function handleStart() {
    setUploadError(null);
    setSavedCount(0);
    setLastSavedAt(null);
    setAutoRunning(true);
  }

  function handleStop() {
    setAutoRunning(false);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="text-lg font-semibold text-ink">固定撮影</h1>
          <button
            type="button"
            onClick={() => setHintOpen(true)}
            className="flex items-center gap-1 text-sm font-medium text-signal transition-colors hover:text-ink"
          >
            <HelpCircle className="h-4 w-4" strokeWidth={1.75} />
            ヒント
          </button>
          {autoRunning && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-signal/10 px-2.5 py-0.5 text-xs font-medium text-signal">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
              </span>
              稼働中
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href="/"
            className="text-sm font-medium text-signal transition-colors hover:text-ink"
          >
            ←戻る
          </Link>
        </div>
      </div>

      <CaptureHintModal open={hintOpen} onClose={() => setHintOpen(false)} />

      <BaseCapturePhotoModal
        open={baseCaptureModalOpen}
        submitting={baseCaptureSubmitting}
        error={baseCaptureError}
        onCancel={() => setBaseCaptureModalOpen(false)}
        onConfirm={() => void handleConfirmBaseCapture()}
      />

      {clearWarning && (
        <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
          {clearWarning}
        </p>
      )}

      <div
        className={`overflow-hidden rounded-lg border bg-black transition ${
          autoRunning
            ? "border-signal ring-2 ring-signal/50 animate-pulse"
            : "border-line"
        }`}
      >
        <div className="relative aspect-[3/4] w-full bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`h-full w-full object-cover ${
              cameraState === "ready" ? "opacity-100" : "opacity-0"
            }`}
          />
          {autoRunning && cameraState === "ready" && (
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
              </span>
              稼働中 · {intervalSec}秒間隔
            </div>
          )}
          {autoRunning && uploadStatus === "uploading" && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-8">
              <div className="h-1 overflow-hidden rounded-full bg-white/25">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-signal" />
              </div>
            </div>
          )}
          {cameraState !== "ready" && (
            <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
              <p className="text-sm text-white/90">
                {cameraState === "starting" && "カメラを起動しています..."}
                {cameraState === "denied" && (cameraError ?? "カメラが拒否されました")}
                {cameraState === "unsupported" && (cameraError ?? "非対応のブラウザです")}
                {cameraState === "error" && (cameraError ?? "カメラエラー")}
              </p>
            </div>
          )}
        </div>
      </div>

      {cameraState !== "ready" && (
        <button
          type="button"
          onClick={() => void startCamera()}
          className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal/50"
        >
          {cameraState === "starting" ? "カメラ起動を再試行" : "カメラを再試行"}
        </button>
      )}

      <label className="flex items-center justify-between gap-3 text-sm text-ink">
        <span>設置向き</span>
        <select
          value={mountOrientation}
          disabled={autoRunning}
          onChange={(e) => setMountOrientation(e.target.value as MountOrientation)}
          className="rounded-md border border-line bg-white px-3 py-1.5 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-50"
        >
          <option value="landscape">横置き固定（左に傾けて設置）</option>
          <option value="portrait">縦置き固定</option>
        </select>
      </label>

      <div className="flex items-center gap-3 text-sm text-ink">
        <label className="flex items-center gap-2">
          <span>撮影間隔</span>
          <select
            value={intervalSec}
            disabled={autoRunning}
            onChange={(e) => setIntervalSec(Number(e.target.value))}
            className="rounded-md border border-line bg-white px-3 py-1.5 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-50"
          >
            {INTERVAL_OPTIONS_SEC.map((sec) => (
              <option key={sec} value={sec}>
                {sec}秒
              </option>
            ))}
          </select>
        </label>
        {!autoRunning && (
          <button
            type="button"
            onClick={() => {
              setBaseCaptureError(null);
              setBaseCaptureModalOpen(true);
            }}
            className="ml-auto rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            基本写真を撮る
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {autoRunning ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center gap-2 rounded-md border-2 border-signal bg-signal/10 px-4 py-3 text-sm font-semibold text-signal"
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            </span>
            <span className="animate-pulse">撮影中</span>
          </div>
        ) : (
          <button
            type="button"
            disabled={cameraState !== "ready"}
            onClick={handleStart}
            className="rounded-md bg-signal px-4 py-3 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            自動撮影開始
          </button>
        )}
        <button
          type="button"
          disabled={!autoRunning}
          onClick={handleStop}
          className={`rounded-md px-4 py-3 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
            autoRunning
              ? "bg-alert shadow-[0_0_16px_rgba(220,38,38,0.45)] ring-2 ring-alert/50 animate-pulse hover:bg-alert/90"
              : "bg-alert/70 hover:bg-alert/90"
          }`}
        >
          停止
        </button>
      </div>

      <div
        className={`rounded-md px-3 py-2 text-xs ${
          autoRunning
            ? "border border-signal/25 bg-signal/5 text-ink"
            : "text-ink-soft"
        }`}
      >
        {autoRunning ? (
          <p className="flex flex-wrap items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
            </span>
            <span className="font-medium text-signal">稼働中</span>
            <span className="text-ink-soft">（{intervalSec}秒間隔で取得＆保存）</span>
          </p>
        ) : (
          <p>表示のみ（未開始）</p>
        )}
        <p className="mt-1 text-ink-soft">
          保存枚数: {savedCount}
          {lastSavedAt
            ? ` · 最終保存 ${lastSavedAt.toLocaleTimeString("ja-JP")}`
            : ""}
          {uploadStatus === "uploading" ? " · 保存中..." : ""}
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={invertRotation}
          disabled={autoRunning}
          onChange={(e) => setInvertRotation(e.target.checked)}
          className="mt-0.5 accent-signal"
        />
        <span>
          保存画像の向きが違うとき：回転方向を反転する
          <span className="mt-0.5 block text-xs text-ink-soft">
            右に傾けて設置した場合や、景色が横倒し／上下逆ならオンにして撮り直してください。
          </span>
        </span>
      </label>

      {uploadStatus === "error" && (
        <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
          {uploadError ?? "エラーが発生しました。もう一度お試しください。"}
        </p>
      )}
    </div>
  );
}
