"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface CaptureAutoFormProps {
  tenantId: string;
  userId: string;
}

type CameraState = "starting" | "ready" | "denied" | "unsupported" | "error";
type UploadStatus = "idle" | "uploading" | "done" | "error";

const INTERVAL_OPTIONS_SEC = [3, 5, 10, 15, 30, 60] as const;

export function CaptureAutoForm({ tenantId, userId }: CaptureAutoFormProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const uploadingRef = useRef(false);
  const cameraReadyRef = useRef(false);
  const supabase = createClient();

  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [intervalSec, setIntervalSec] = useState<number>(5);
  const [autoRunning, setAutoRunning] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [clearWarning, setClearWarning] = useState<string | null>(null);

  const clearOwnAutoCaptures = useCallback(async () => {
    setClearWarning(null);
    try {
      const { data: rows, error: selectError } = await supabase
        .from("auto_captures")
        .select("id, storage_path")
        .eq("tenant_id", tenantId)
        .eq("captured_by", userId);

      if (selectError) throw selectError;
      if (!rows || rows.length === 0) return;

      const paths = rows
        .map((r) => r.storage_path as string)
        .filter((p) => Boolean(p));

      if (paths.length > 0) {
        const { error: storageError } = await supabase.storage
          .from("auto-captures")
          .remove(paths);
        if (storageError) throw storageError;
      }

      const { error: deleteError } = await supabase
        .from("auto_captures")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("captured_by", userId);

      if (deleteError) throw deleteError;
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

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      cameraReadyRef.current = true;
      setCameraState("ready");
    } catch (err) {
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
    let cancelled = false;

    void (async () => {
      await clearOwnAutoCaptures();
      if (cancelled) return;
      await startCamera();
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [clearOwnAutoCaptures, startCamera, stopCamera]);

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
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("キャンバスを初期化できませんでした");

      ctx.drawImage(video, 0, 0, width, height);

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
  }, [supabase, tenantId, userId]);

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
        <h1 className="text-lg font-semibold text-ink">アプリ内撮影</h1>
        <Link
          href="/"
          className="shrink-0 text-sm font-medium text-signal transition-colors hover:text-ink"
        >
          ←戻る
        </Link>
      </div>
      <p className="text-sm text-ink/70">
        カメラ映像を表示します。「自動撮影開始」で間隔ごとに取得＆保存を開始し、「停止」で終了します。
        この画面を開くと、前回保存した自分の定点監視画像は削除されます。
      </p>

      {clearWarning && (
        <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
          {clearWarning}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-black">
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

      {cameraState !== "ready" && cameraState !== "starting" && (
        <button
          type="button"
          onClick={() => void startCamera()}
          className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal/50"
        >
          カメラを再試行
        </button>
      )}

      <label className="flex items-center justify-between gap-3 text-sm text-ink">
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

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={cameraState !== "ready" || autoRunning}
          onClick={handleStart}
          className="rounded-md bg-signal px-4 py-3 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          自動撮影開始
        </button>
        <button
          type="button"
          disabled={!autoRunning}
          onClick={handleStop}
          className="rounded-md bg-alert px-4 py-3 text-sm font-medium text-white transition hover:bg-alert/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          停止
        </button>
      </div>

      <p className="text-xs text-ink-soft">
        {autoRunning
          ? `取得＆保存中（${intervalSec}秒間隔）`
          : "表示のみ（未開始）"}
        {" · "}
        保存枚数: {savedCount}
        {lastSavedAt
          ? ` · 最終保存 ${lastSavedAt.toLocaleTimeString("ja-JP")}`
          : ""}
        {uploadStatus === "uploading" ? " · 保存中..." : ""}
      </p>

      {uploadStatus === "error" && (
        <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
          {uploadError ?? "エラーが発生しました。もう一度お試しください。"}
        </p>
      )}
    </div>
  );
}
