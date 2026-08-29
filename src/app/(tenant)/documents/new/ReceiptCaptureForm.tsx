"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Check, FileCheck2, Receipt, Save, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyTiltReading,
  captureFrameFromVideo,
  LANDSCAPE_LEFT_TILT_SCREEN_ANGLE,
  mountFromDeviceTilt,
  readScreenAngle,
  resolveHandheldMount,
  type MountOrientation,
} from "@/lib/capture/captureFrameFromVideo";
import { BUCKET, tmpObjectPath } from "@/lib/documents/storagePaths";
import {
  RECEIPT_EXPENSE_FIELD_LABELS,
  RECEIPT_EXPENSE_HEADER_KEYS,
  RECEIPT_QUALIFIED_FIELD_LABELS,
  RECEIPT_QUALIFIED_HEADER_KEYS,
} from "@/lib/documents/types/receipt/plugin";
import { createClient } from "@/lib/supabase/client";

interface ReceiptCaptureFormProps {
  tenantId: string;
  userId: string;
}

type ReceiptMode = "expense" | "qualified_invoice";
type FlowStep = "select_mode" | "capture" | "review";
type CameraState = "idle" | "starting" | "ready" | "denied" | "unsupported" | "error";
type FlowStatus = "idle" | "uploading" | "analyzing" | "saving" | "error";

type CapturedPage = {
  blob: Blob;
  previewUrl: string;
};

type TmpPage = {
  role: "page";
  tmpPath: string;
};

type DuplicatePayload = {
  id: string;
  canMutate: boolean;
  extracted?: Record<string, string>;
  notes?: string;
  tags?: string[];
  contextDate?: string | null;
  companyVisible?: boolean;
  images: { role: string; url: string | null }[];
};

type AnalyzeResponse = {
  extracted?: Record<string, string>;
  rawOcr?: string;
  warning?: "ocr_failed";
  analysisRunId?: string | null;
  duplicate?: DuplicatePayload | null;
  error?: string;
};

const MODE_META: Record<
  ReceiptMode,
  { label: string; description: string; headerKeys: readonly string[]; fieldLabels: Record<string, string> }
> = {
  expense: {
    label: "社内経費処理用",
    description: "日付・金額・支払方法・勘定科目など、経費精算に必要な項目を読み取ります。",
    headerKeys: RECEIPT_EXPENSE_HEADER_KEYS,
    fieldLabels: RECEIPT_EXPENSE_FIELD_LABELS,
  },
  qualified_invoice: {
    label: "インボイス制度対応用（法定記載事項）",
    description: "登録番号・税率区分ごとの合計額など、適格請求書の記載事項を読み取ります。",
    headerKeys: RECEIPT_QUALIFIED_HEADER_KEYS,
    fieldLabels: RECEIPT_QUALIFIED_FIELD_LABELS,
  },
};

const MANUAL_ONLY_KEYS = new Set([
  "purpose",
  "participants",
  "participant_count",
  "department_code",
  "applicant",
  "approver",
]);

function emptyHeader(keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, ""]));
}

function isValidYyyyMmDd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function requestMotionPermission(): Promise<void> {
  try {
    const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DOE.requestPermission === "function") {
      return DOE.requestPermission().then(() => undefined);
    }
  } catch {
    // Permission denied: shutter falls back to screen orientation.
  }
  return Promise.resolve();
}

function parseTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,\n、]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

async function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("画像の生成に失敗しました。"));
      },
      "image/jpeg",
      0.92
    );
  });
}

export function ReceiptCaptureForm({ tenantId, userId }: ReceiptCaptureFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tmpPageRef = useRef<TmpPage | null>(null);
  const capturedPreviewUrlRef = useRef<string | null>(null);
  const tiltMountRef = useRef<MountOrientation | null>(null);
  const tiltListenFromRef = useRef(0);
  const landscapeStreakRef = useRef(0);
  const onDeviceOrientationRef = useRef((event: DeviceOrientationEvent) => {
    if (Date.now() < tiltListenFromRef.current) return;
    const reading = mountFromDeviceTilt(event.gamma, event.beta);
    const next = applyTiltReading(reading, landscapeStreakRef.current, tiltMountRef.current);
    landscapeStreakRef.current = next.landscapeStreak;
    tiltMountRef.current = next.tilt;
  });

  const [step, setStep] = useState<FlowStep>("select_mode");
  const [mode, setMode] = useState<ReceiptMode | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flowStatus, setFlowStatus] = useState<FlowStatus>("idle");
  const [flowError, setFlowError] = useState<string | null>(null);
  const [page, setPage] = useState<CapturedPage | null>(null);
  const [tmpPage, setTmpPage] = useState<TmpPage | null>(null);
  const [extracted, setExtracted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [contextDate, setContextDate] = useState("");
  const [companyVisible, setCompanyVisible] = useState(true);
  const [analysisRunId, setAnalysisRunId] = useState<string | null>(null);
  const [rawOcr, setRawOcr] = useState("");
  const [ocrWarning, setOcrWarning] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicatePayload | null>(null);

  const meta = mode ? MODE_META[mode] : null;
  const readOnly = duplicate?.canMutate === false;
  const tagChips = parseTags(tagsInput);
  const canAnalyze = !!page && flowStatus !== "uploading" && flowStatus !== "analyzing";
  const canSave = step === "review" && !readOnly && flowStatus !== "saving" && !!tmpPage;
  const busy =
    flowStatus === "uploading" || flowStatus === "analyzing" || flowStatus === "saving";
  const showLiveCamera = cameraState === "starting" || cameraState === "ready";

  const stopCamera = useCallback(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("deviceorientation", onDeviceOrientationRef.current);
    }
    tiltMountRef.current = null;
    landscapeStreakRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const removeTmpObject = useCallback(
    async (tmp: TmpPage | null) => {
      if (!tmp) return;
      const { error } = await supabase.storage.from(BUCKET).remove([tmp.tmpPath]);
      if (error) {
        console.error("receipt tmp remove failed", error);
      }
    },
    [supabase]
  );

  const clearTmpPage = useCallback(async () => {
    const current = tmpPageRef.current;
    tmpPageRef.current = null;
    setTmpPage(null);
    await removeTmpObject(current);
  }, [removeTmpObject]);

  useEffect(() => {
    tmpPageRef.current = tmpPage;
  }, [tmpPage]);

  useEffect(() => {
    capturedPreviewUrlRef.current = page?.previewUrl ?? null;
  }, [page]);

  useEffect(() => {
    return () => {
      stopCamera();
      if (capturedPreviewUrlRef.current) {
        URL.revokeObjectURL(capturedPreviewUrlRef.current);
      }
      void removeTmpObject(tmpPageRef.current);
    };
  }, [removeTmpObject, stopCamera]);

  const startCamera = useCallback(async () => {
    setCameraState("starting");
    setCameraError(null);
    setFlowError(null);
    stopCamera();

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      setCameraError(
        "このブラウザではカメラAPIを利用できません。HTTPSで開いているか確認してください。"
      );
      return;
    }

    try {
      await requestMotionPermission();
      tiltMountRef.current = null;
      landscapeStreakRef.current = 0;
      tiltListenFromRef.current = Date.now() + 300;
      if (typeof window !== "undefined") {
        window.addEventListener("deviceorientation", onDeviceOrientationRef.current);
      }

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
      setCameraState("ready");
    } catch (err) {
      stopCamera();
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
        setCameraError(err instanceof Error ? err.message : "カメラの起動に失敗しました");
      }
    }
  }, [stopCamera]);

  function selectMode(next: ReceiptMode) {
    setMode(next);
    setStep("capture");
  }

  async function handleShutter() {
    const video = videoRef.current;
    if (!video || cameraState !== "ready") return;
    if (!video.videoWidth || !video.videoHeight) {
      setFlowError("映像の準備ができていません。少し待ってから再度お試しください。");
      return;
    }

    try {
      const rawAngle = readScreenAngle();
      const mountOrientation = resolveHandheldMount({
        screenAngle: rawAngle,
        viewportIsLandscape:
          typeof window !== "undefined" && window.innerWidth > window.innerHeight,
        screenOrientationType:
          typeof screen !== "undefined" ? screen.orientation?.type ?? "" : "",
        deviceTiltMount: tiltMountRef.current,
      });
      const screenAngle =
        mountOrientation === "landscape" ? LANDSCAPE_LEFT_TILT_SCREEN_ANGLE : rawAngle;
      const canvas = captureFrameFromVideo(video, mountOrientation, false, screenAngle);
      const blob = await blobFromCanvas(canvas);
      const previewUrl = URL.createObjectURL(blob);

      if (page) {
        URL.revokeObjectURL(page.previewUrl);
      }
      setPage({ blob, previewUrl });
      stopCamera();
      setCameraState("idle");
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : "画像の生成に失敗しました。");
    }
  }

  function handleRetake() {
    if (page) {
      URL.revokeObjectURL(page.previewUrl);
    }
    setPage(null);
    setFlowError(null);
  }

  async function uploadTmpPage(): Promise<TmpPage> {
    if (!page) throw new Error("撮影されていません。");
    const path = tmpObjectPath(tenantId, userId, crypto.randomUUID());
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, page.blob, { contentType: "image/jpeg" });
    if (error) throw error;
    return { role: "page", tmpPath: path };
  }

  async function handleAnalyze() {
    if (!mode) return;
    setFlowError(null);
    setOcrWarning(false);
    setDuplicate(null);
    setAnalysisRunId(null);
    setRawOcr("");
    await clearTmpPage();

    try {
      setFlowStatus("uploading");
      const uploaded = await uploadTmpPage();
      tmpPageRef.current = uploaded;
      setTmpPage(uploaded);

      setFlowStatus("analyzing");
      const response = await fetch("/api/documents/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "receipt",
          documentMode: mode,
          images: [{ role: uploaded.role, path: uploaded.tmpPath }],
        }),
      });
      const result = (await response.json().catch(() => ({}))) as AnalyzeResponse;
      if (!response.ok) {
        throw new Error(result.error ?? "解析に失敗しました。");
      }

      const headerKeys = MODE_META[mode].headerKeys;
      const nextExtracted = emptyHeader(headerKeys);
      for (const key of headerKeys) {
        if (!MANUAL_ONLY_KEYS.has(key)) {
          nextExtracted[key] = result.extracted?.[key] ?? "";
        }
      }

      const duplicateSeed = result.duplicate?.canMutate ? result.duplicate : null;
      if (duplicateSeed?.extracted) {
        for (const key of headerKeys) {
          nextExtracted[key] = duplicateSeed.extracted[key] ?? nextExtracted[key];
        }
      }

      const transactionDate = nextExtracted.transaction_date ?? "";
      const initialContextDate =
        duplicateSeed?.contextDate != null
          ? duplicateSeed.contextDate
          : isValidYyyyMmDd(transactionDate)
            ? transactionDate
            : "";

      setExtracted(nextExtracted);
      setNotes(duplicateSeed?.notes ?? "");
      setTagsInput(duplicateSeed?.tags?.join(", ") ?? "");
      setContextDate(initialContextDate);
      setCompanyVisible(duplicateSeed?.companyVisible ?? true);
      setAnalysisRunId(result.analysisRunId ?? null);
      setRawOcr(result.rawOcr ?? "");
      setOcrWarning(result.warning === "ocr_failed");
      setDuplicate(result.duplicate ?? null);
      setStep("review");
      setFlowStatus("idle");
    } catch (err) {
      console.error("receipt analyze failed", err);
      await clearTmpPage();
      setFlowStatus("error");
      setFlowError(err instanceof Error ? err.message : "解析に失敗しました。");
    }
  }

  async function handleBackToCapture() {
    await clearTmpPage();
    setStep("capture");
    setFlowStatus("idle");
    setFlowError(null);
    setOcrWarning(false);
    setDuplicate(null);
    setAnalysisRunId(null);
    setRawOcr("");
  }

  async function handleSave() {
    if (!canSave || !mode || !tmpPage) return;
    setFlowStatus("saving");
    setFlowError(null);

    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "receipt",
          documentMode: mode,
          existingId: duplicate?.canMutate ? duplicate.id : null,
          companyVisible,
          notes,
          tags: tagChips,
          contextDate: contextDate || null,
          extracted,
          rawOcr,
          analysisRunId,
          images: [{ role: tmpPage.role, tmpPath: tmpPage.tmpPath }],
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        duplicateId?: string;
      };
      if (!response.ok) {
        if (response.status === 409 && result.duplicateId) {
          setDuplicate({
            id: result.duplicateId,
            canMutate: false,
            companyVisible: false,
            images: [],
          });
        }
        throw new Error(result.error ?? "保存に失敗しました。");
      }

      tmpPageRef.current = null;
      setTmpPage(null);
      router.push(`/documents?type=receipt&mode=${mode}`);
    } catch (err) {
      console.error("receipt save failed", err);
      setFlowStatus("error");
      setFlowError(err instanceof Error ? err.message : "保存に失敗しました。");
    }
  }

  if (step === "select_mode" || !mode || !meta) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-5 bg-paper p-6 pb-12 text-ink">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-signal">文書ホルダー</p>
            <h1 className="text-lg font-semibold text-ink">領収書を撮る</h1>
          </div>
          <Link href="/" className="text-sm font-medium text-signal transition-colors hover:text-ink">
            ←戻る
          </Link>
        </div>

        <p className="text-sm text-ink-soft">区分を選択してください。</p>

        <div className="flex flex-col gap-3">
          {(Object.entries(MODE_META) as [ReceiptMode, (typeof MODE_META)[ReceiptMode]][]).map(
            ([id, item]) => (
              <button
                key={id}
                type="button"
                onClick={() => selectMode(id)}
                className="flex items-start gap-3 rounded-lg border border-line bg-white p-4 text-left transition hover:border-signal/50"
              >
                {id === "expense" ? (
                  <Receipt className="mt-0.5 h-5 w-5 shrink-0 text-signal" strokeWidth={1.75} />
                ) : (
                  <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-signal" strokeWidth={1.75} />
                )}
                <span>
                  <span className="block text-sm font-semibold text-ink">{item.label}</span>
                  <span className="mt-1 block text-xs text-ink-soft">{item.description}</span>
                </span>
              </button>
            )
          )}
        </div>
      </div>
    );
  }

  if (step === "review") {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-5 bg-paper p-6 pb-12 text-ink">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-signal">文書ホルダー・{meta.label}</p>
            <h1 className="text-lg font-semibold text-ink">領収書を確認・保存</h1>
          </div>
          <button
            type="button"
            onClick={() => void handleBackToCapture()}
            disabled={busy}
            className="text-sm font-medium text-signal transition-colors hover:text-ink disabled:opacity-50"
          >
            ←戻る
          </button>
        </div>

        {ocrWarning && (
          <div className="rounded-md border border-alert/30 bg-alert/10 px-3 py-2 text-sm text-alert">
            OCRに失敗しました。画像は保持しているため、項目を手入力して保存できます。
          </div>
        )}

        {duplicate && (
          <div className="rounded-md border border-line bg-white p-3 text-sm">
            <p className="font-medium text-ink">
              {duplicate.canMutate
                ? "重複候補が見つかりました。保存すると既存データを更新します。"
                : "編集権限のない重複データが見つかりました。"}
            </p>
            {!duplicate.canMutate && (
              <Link
                href={`/documents?type=receipt&mode=${mode}&open=${duplicate.id}`}
                className="mt-2 inline-flex font-medium text-signal transition-colors hover:text-ink"
              >
                ホルダーで開く
              </Link>
            )}
          </div>
        )}

        {page && (
          <section className="overflow-hidden rounded-lg border border-line bg-black">
            <div className="aspect-3/4 w-full bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.previewUrl}
                alt="領収書プレビュー"
                className="h-full w-full object-contain"
              />
            </div>
          </section>
        )}

        <section className="space-y-3 rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-bold text-ink">項目</h2>
          {meta.headerKeys.map((key) =>
            key === "payment_method" ? (
              <label key={key} className="block space-y-1.5">
                <span className="text-xs font-medium text-ink-soft">{meta.fieldLabels[key]}</span>
                <input
                  type="text"
                  list="payment-method-options"
                  value={extracted[key] ?? ""}
                  onChange={(event) =>
                    setExtracted((current) => ({ ...current, [key]: event.target.value }))
                  }
                  disabled={readOnly || busy}
                  placeholder="例: 現金 / カード / 振込"
                  className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-60"
                />
                <datalist id="payment-method-options">
                  <option value="現金" />
                  <option value="カード" />
                  <option value="振込" />
                </datalist>
              </label>
            ) : (
              <label key={key} className="block space-y-1.5">
                <span className="text-xs font-medium text-ink-soft">{meta.fieldLabels[key]}</span>
                <input
                  type="text"
                  value={extracted[key] ?? ""}
                  onChange={(event) =>
                    setExtracted((current) => ({ ...current, [key]: event.target.value }))
                  }
                  disabled={readOnly || busy}
                  className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-60"
                />
              </label>
            )
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-line bg-white p-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">メモ</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              disabled={readOnly || busy}
              className="w-full resize-y rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-60"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">タグ</span>
            <input
              type="text"
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              placeholder="例: 出張, 経費"
              disabled={readOnly || busy}
              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-60"
            />
          </label>
          {tagChips.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tagChips.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-line bg-paper px-2 py-1 text-xs text-ink"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">取引日</span>
            <input
              type="date"
              value={contextDate}
              onChange={(event) => setContextDate(event.target.value)}
              disabled={readOnly || busy}
              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-60"
            />
          </label>

          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={companyVisible}
              onChange={(event) => setCompanyVisible(event.target.checked)}
              disabled={readOnly || busy}
              className="accent-signal disabled:opacity-60"
            />
            会社に公開する
          </label>
        </section>

        {flowError && (
          <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{flowError}</p>
        )}

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-signal px-4 py-3 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-4 w-4" strokeWidth={1.75} />
          {flowStatus === "saving"
            ? "保存中..."
            : duplicate?.canMutate
              ? "更新する"
              : "送信"}
        </button>
      </div>
    );
  }

  // Capture phase
  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 bg-paper p-6 pb-12 text-ink">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-signal">文書ホルダー・{meta.label}</p>
          <h1 className="text-lg font-semibold text-ink">領収書を撮る</h1>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          <Link
            href={`/documents?type=receipt&mode=${mode}`}
            className="font-medium text-signal transition-colors hover:text-ink"
          >
            ホルダー
          </Link>
          <button
            type="button"
            onClick={() => setStep("select_mode")}
            disabled={busy}
            className="font-medium text-signal transition-colors hover:text-ink disabled:opacity-50"
          >
            区分を変更
          </button>
        </div>
      </div>

      <section className="space-y-3 rounded-lg border border-line bg-white p-4">
        <div>
          <h2 className="text-sm font-bold text-ink">領収書を撮影（{meta.label}）</h2>
          <p className="mt-1 text-xs text-ink-soft">1枚のみ撮影できます。</p>
        </div>

        {showLiveCamera && (
          <div className="overflow-hidden rounded-lg border border-line bg-black">
            <div className="relative aspect-3/4 w-full bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`h-full w-full object-cover ${
                  cameraState === "ready" ? "opacity-100" : "opacity-0"
                }`}
              />
              {cameraState === "starting" && (
                <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
                  <p className="text-sm text-white/90">カメラを起動しています...</p>
                </div>
              )}
            </div>
          </div>
        )}

        {!showLiveCamera && page && (
          <div className="overflow-hidden rounded-lg border border-line bg-black">
            <div className="aspect-3/4 w-full bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={page.previewUrl}
                alt="領収書プレビュー"
                className="h-full w-full object-contain"
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          {!showLiveCamera && !page && (
            <button
              type="button"
              onClick={() => void startCamera()}
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-line bg-paper px-4 py-3 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
            >
              <Camera className="h-4 w-4 text-signal" strokeWidth={1.75} />
              カメラを起動する
            </button>
          )}

          {!showLiveCamera && page && (
            <button
              type="button"
              onClick={handleRetake}
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-line bg-paper px-4 py-2 text-sm text-ink transition hover:border-signal/50 disabled:opacity-50"
            >
              撮り直す
            </button>
          )}

          {cameraState === "ready" && (
            <button
              type="button"
              onClick={() => void handleShutter()}
              className="w-full rounded-md bg-ink px-4 py-3 text-sm font-medium text-white transition hover:bg-ink/90"
            >
              シャッター
            </button>
          )}

          {showLiveCamera && (
            <button
              type="button"
              onClick={() => {
                stopCamera();
                setCameraState("idle");
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-line bg-paper px-4 py-2 text-sm text-ink transition hover:border-signal/50"
            >
              キャンセル
            </button>
          )}

          {(cameraState === "denied" ||
            cameraState === "unsupported" ||
            cameraState === "error") &&
            cameraError && (
              <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{cameraError}</p>
            )}
        </div>
      </section>

      {flowError && (
        <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{flowError}</p>
      )}

      <button
        type="button"
        onClick={() => void handleAnalyze()}
        disabled={!canAnalyze}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-signal px-4 py-3 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {flowStatus === "uploading" || flowStatus === "analyzing" ? (
          <Search className="h-4 w-4" strokeWidth={1.75} />
        ) : (
          <Check className="h-4 w-4" strokeWidth={1.75} />
        )}
        {flowStatus === "uploading"
          ? "アップロード中..."
          : flowStatus === "analyzing"
            ? "解析中..."
            : "読み取る"}
      </button>
    </div>
  );
}
