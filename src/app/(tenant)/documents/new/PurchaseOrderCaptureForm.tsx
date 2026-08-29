"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, Check, Plus, Save, Search, Trash2 } from "lucide-react";
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
  PURCHASE_ORDER_FIELD_LABELS,
  PURCHASE_ORDER_HEADER_KEYS,
  type PurchaseOrderHeaderKey,
} from "@/lib/documents/types/purchase_order/plugin";
import type { LineItemDraft } from "@/lib/documents/pluginTypes";
import { createClient } from "@/lib/supabase/client";

interface PurchaseOrderCaptureFormProps {
  tenantId: string;
  userId: string;
}

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
  lineItems?: LineItemDraft[];
  rawOcr?: string;
  warning?: "ocr_failed";
  analysisRunId?: string | null;
  duplicate?: DuplicatePayload | null;
  error?: string;
};

const MAX_PAGES = 10;

function emptyHeader(): Record<PurchaseOrderHeaderKey, string> {
  return Object.fromEntries(PURCHASE_ORDER_HEADER_KEYS.map((k) => [k, ""])) as Record<
    PurchaseOrderHeaderKey,
    string
  >;
}

function newLineItem(lineNo: number): LineItemDraft {
  return {
    line_no: lineNo,
    transaction_date: null,
    description: "",
    quantity: "",
    unit: "",
    unit_price: "",
    amount: "",
    tax_rate: "",
  };
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

export function PurchaseOrderCaptureForm({ tenantId, userId }: PurchaseOrderCaptureFormProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tmpPagesRef = useRef<TmpPage[]>([]);
  const capturedPreviewUrlsRef = useRef<string[]>([]);
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

  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flowStatus, setFlowStatus] = useState<FlowStatus>("idle");
  const [flowError, setFlowError] = useState<string | null>(null);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [tmpPages, setTmpPages] = useState<TmpPage[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [extracted, setExtracted] = useState<Record<PurchaseOrderHeaderKey, string>>(emptyHeader());
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([]);
  const [notes, setNotes] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [contextDate, setContextDate] = useState("");
  const [companyVisible, setCompanyVisible] = useState(true);
  const [analysisRunId, setAnalysisRunId] = useState<string | null>(null);
  const [rawOcr, setRawOcr] = useState("");
  const [ocrWarning, setOcrWarning] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicatePayload | null>(null);
  const [activePageIndex, setActivePageIndex] = useState(0);

  const readOnly = duplicate?.canMutate === false;
  const tagChips = parseTags(tagsInput);
  const canAnalyze =
    pages.length > 0 && flowStatus !== "uploading" && flowStatus !== "analyzing";
  const canSave = confirming && !readOnly && flowStatus !== "saving" && tmpPages.length > 0;
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

  const removeTmpObjects = useCallback(
    async (images: TmpPage[]) => {
      const paths = images.map((p) => p.tmpPath);
      if (paths.length === 0) return;
      const { error } = await supabase.storage.from(BUCKET).remove(paths);
      if (error) {
        console.error("purchase_order tmp remove failed", error);
      }
    },
    [supabase]
  );

  const clearTmpPages = useCallback(async () => {
    const current = tmpPagesRef.current;
    tmpPagesRef.current = [];
    setTmpPages([]);
    await removeTmpObjects(current);
  }, [removeTmpObjects]);

  useEffect(() => {
    tmpPagesRef.current = tmpPages;
  }, [tmpPages]);

  useEffect(() => {
    capturedPreviewUrlsRef.current = pages.map((p) => p.previewUrl);
  }, [pages]);

  useEffect(() => {
    return () => {
      stopCamera();
      for (const url of capturedPreviewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      void removeTmpObjects(tmpPagesRef.current);
    };
  }, [removeTmpObjects, stopCamera]);

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

  async function handleShutter() {
    const video = videoRef.current;
    if (!video || cameraState !== "ready") return;
    if (!video.videoWidth || !video.videoHeight) {
      setFlowError("映像の準備ができていません。少し待ってから再度お試しください。");
      return;
    }

    try {
      const rawAngle = readScreenAngle();
      const mount = resolveHandheldMount({
        screenAngle: rawAngle,
        viewportIsLandscape:
          typeof window !== "undefined" && window.innerWidth > window.innerHeight,
        screenOrientationType:
          typeof screen !== "undefined" ? screen.orientation?.type ?? "" : "",
        deviceTiltMount: tiltMountRef.current,
      });
      const screenAngle = mount === "landscape" ? LANDSCAPE_LEFT_TILT_SCREEN_ANGLE : rawAngle;
      const canvas = captureFrameFromVideo(video, mount, false, screenAngle);
      const blob = await blobFromCanvas(canvas);
      const previewUrl = URL.createObjectURL(blob);

      setPages((current) => [...current, { blob, previewUrl }]);
      stopCamera();
      setCameraState("idle");
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : "画像の生成に失敗しました。");
    }
  }

  function handleDeletePage(index: number) {
    setPages((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_, i) => i !== index);
    });
    setActivePageIndex((current) => Math.max(0, Math.min(current, pages.length - 2)));
  }

  async function uploadTmpPages(): Promise<TmpPage[]> {
    if (pages.length === 0) throw new Error("ページが撮影されていません。");
    const uploaded: TmpPage[] = [];
    try {
      for (const page of pages) {
        const path = tmpObjectPath(tenantId, userId, crypto.randomUUID());
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(path, page.blob, { contentType: "image/jpeg" });
        if (error) throw error;
        uploaded.push({ role: "page", tmpPath: path });
      }
      return uploaded;
    } catch (err) {
      await removeTmpObjects(uploaded);
      throw err;
    }
  }

  async function handleAnalyze() {
    setFlowError(null);
    setOcrWarning(false);
    setDuplicate(null);
    setAnalysisRunId(null);
    setRawOcr("");
    await clearTmpPages();

    try {
      setFlowStatus("uploading");
      const uploaded = await uploadTmpPages();
      tmpPagesRef.current = uploaded;
      setTmpPages(uploaded);

      setFlowStatus("analyzing");
      const response = await fetch("/api/documents/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "purchase_order",
          images: uploaded.map((p) => ({ role: p.role, path: p.tmpPath })),
        }),
      });
      const result = (await response.json().catch(() => ({}))) as AnalyzeResponse;
      if (!response.ok) {
        throw new Error(result.error ?? "解析に失敗しました。");
      }

      const nextExtracted = emptyHeader();
      for (const key of PURCHASE_ORDER_HEADER_KEYS) {
        nextExtracted[key] = result.extracted?.[key] ?? "";
      }

      const duplicateSeed = result.duplicate?.canMutate ? result.duplicate : null;
      if (duplicateSeed?.extracted) {
        for (const key of PURCHASE_ORDER_HEADER_KEYS) {
          nextExtracted[key] = duplicateSeed.extracted[key] ?? nextExtracted[key];
        }
      }

      const issueDate = nextExtracted.issue_date;
      const initialContextDate =
        duplicateSeed?.contextDate != null
          ? duplicateSeed.contextDate
          : isValidYyyyMmDd(issueDate)
            ? issueDate
            : "";

      setExtracted(nextExtracted);
      setLineItems(result.lineItems ?? []);
      setNotes(duplicateSeed?.notes ?? "");
      setTagsInput(duplicateSeed?.tags?.join(", ") ?? "");
      setContextDate(initialContextDate);
      setCompanyVisible(duplicateSeed?.companyVisible ?? true);
      setAnalysisRunId(result.analysisRunId ?? null);
      setRawOcr(result.rawOcr ?? "");
      setOcrWarning(result.warning === "ocr_failed");
      setDuplicate(result.duplicate ?? null);
      setConfirming(true);
      setActivePageIndex(0);
      setFlowStatus("idle");
    } catch (err) {
      console.error("purchase_order analyze failed", err);
      await clearTmpPages();
      setFlowStatus("error");
      setFlowError(err instanceof Error ? err.message : "解析に失敗しました。");
    }
  }

  async function handleBackToCapture() {
    await clearTmpPages();
    setConfirming(false);
    setFlowStatus("idle");
    setFlowError(null);
    setOcrWarning(false);
    setDuplicate(null);
    setAnalysisRunId(null);
    setRawOcr("");
  }

  async function handleSave() {
    if (!canSave) return;
    setFlowStatus("saving");
    setFlowError(null);

    try {
      const normalizedLineItems = lineItems.map((item, index) => ({
        ...item,
        line_no: index + 1,
      }));

      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "purchase_order",
          existingId: duplicate?.canMutate ? duplicate.id : null,
          companyVisible,
          notes,
          tags: tagChips,
          contextDate: contextDate || null,
          extracted,
          rawOcr,
          analysisRunId,
          lineItems: normalizedLineItems,
          images: tmpPages.map((p) => ({ role: p.role, tmpPath: p.tmpPath })),
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

      tmpPagesRef.current = [];
      setTmpPages([]);
      router.push("/documents?type=purchase_order");
    } catch (err) {
      console.error("purchase_order save failed", err);
      setFlowStatus("error");
      setFlowError(err instanceof Error ? err.message : "保存に失敗しました。");
    }
  }

  function addLineItem() {
    setLineItems((current) => [...current, newLineItem(current.length + 1)]);
  }

  function removeLineItem(index: number) {
    setLineItems((current) => current.filter((_, i) => i !== index));
  }

  function updateLineItem(
    index: number,
    field: keyof LineItemDraft,
    value: string | null
  ) {
    setLineItems((current) =>
      current.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  if (confirming) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-5 bg-paper p-6 pb-12 text-ink">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-signal">文書ホルダー</p>
            <h1 className="text-lg font-semibold text-ink">発注書を確認・保存</h1>
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
                href={`/documents?type=purchase_order&open=${duplicate.id}`}
                className="mt-2 inline-flex font-medium text-signal transition-colors hover:text-ink"
              >
                ホルダーで開く
              </Link>
            )}
          </div>
        )}

        {/* Page preview with tab switcher */}
        <section className="space-y-3">
          {pages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pages.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setActivePageIndex(index)}
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
                    activePageIndex === index
                      ? "border-signal bg-signal text-white"
                      : "border-line bg-white text-ink hover:border-signal/50"
                  }`}
                >
                  P{index + 1}
                </button>
              ))}
            </div>
          )}
          <div className="overflow-hidden rounded-lg border border-line bg-black">
            <div className="aspect-3/4 w-full bg-black">
              {pages[activePageIndex] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pages[activePageIndex]!.previewUrl}
                  alt={`ページ ${activePageIndex + 1} プレビュー`}
                  className="h-full w-full object-contain"
                />
              )}
            </div>
          </div>
        </section>

        {/* 16-field header form */}
        <section className="space-y-3 rounded-lg border border-line bg-white p-4">
          <h2 className="text-sm font-bold text-ink">ヘッダー項目</h2>
          {PURCHASE_ORDER_HEADER_KEYS.map((key) => (
            <label key={key} className="block space-y-1.5">
              <span className="text-xs font-medium text-ink-soft">
                {PURCHASE_ORDER_FIELD_LABELS[key]}
              </span>
              <input
                type="text"
                value={extracted[key]}
                onChange={(event) =>
                  setExtracted((current) => ({ ...current, [key]: event.target.value }))
                }
                disabled={readOnly || busy}
                className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-60"
              />
            </label>
          ))}
        </section>

        {/* Editable line items table */}
        <section className="space-y-3 rounded-lg border border-line bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">明細</h2>
            {!readOnly && !busy && (
              <button
                type="button"
                onClick={addLineItem}
                className="inline-flex items-center gap-1 text-xs font-medium text-signal hover:text-ink"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                行を追加
              </button>
            )}
          </div>

          {lineItems.length === 0 ? (
            <p className="text-xs text-ink-soft">明細はありません。</p>
          ) : (
            <div className="space-y-3">
              {lineItems.map((item, index) => (
                <div key={index} className="rounded-md border border-line bg-paper p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-ink-soft">#{index + 1}</span>
                    {!readOnly && !busy && (
                      <button
                        type="button"
                        onClick={() => removeLineItem(index)}
                        className="text-alert hover:text-alert/70"
                        aria-label={`明細 ${index + 1} を削除`}
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="col-span-2 block space-y-1">
                      <span className="text-xs text-ink-soft">品名</span>
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateLineItem(index, "description", e.target.value)}
                        disabled={readOnly || busy}
                        className="w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-ink-soft">明細日付</span>
                      <input
                        type="text"
                        value={item.transaction_date ?? ""}
                        onChange={(e) =>
                          updateLineItem(
                            index,
                            "transaction_date",
                            e.target.value || null
                          )
                        }
                        disabled={readOnly || busy}
                        placeholder="YYYY-MM-DD"
                        className="w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-ink-soft">税率</span>
                      <select
                        value={item.tax_rate}
                        onChange={(e) => updateLineItem(index, "tax_rate", e.target.value)}
                        disabled={readOnly || busy}
                        className="w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                      >
                        <option value="">不明</option>
                        <option value="10">10%</option>
                        <option value="8">8%（軽減）</option>
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-ink-soft">数量</span>
                      <input
                        type="text"
                        value={item.quantity}
                        onChange={(e) => updateLineItem(index, "quantity", e.target.value)}
                        disabled={readOnly || busy}
                        className="w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-ink-soft">単位</span>
                      <input
                        type="text"
                        value={item.unit}
                        onChange={(e) => updateLineItem(index, "unit", e.target.value)}
                        disabled={readOnly || busy}
                        className="w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-ink-soft">単価</span>
                      <input
                        type="text"
                        value={item.unit_price}
                        onChange={(e) => updateLineItem(index, "unit_price", e.target.value)}
                        disabled={readOnly || busy}
                        className="w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-ink-soft">金額</span>
                      <input
                        type="text"
                        value={item.amount}
                        onChange={(e) => updateLineItem(index, "amount", e.target.value)}
                        disabled={readOnly || busy}
                        className="w-full rounded border border-line bg-white px-2 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!readOnly && !busy && (
            <button
              type="button"
              onClick={addLineItem}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-signal/40 px-4 py-2 text-sm text-signal transition hover:bg-signal/5"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              明細行を追加
            </button>
          )}
        </section>

        {/* Notes, tags, contextDate, companyVisible */}
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
              placeholder="例: 仕入, 経費"
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
              : "保存する"}
        </button>
      </div>
    );
  }

  // Capture phase
  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 bg-paper p-6 pb-12 text-ink">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-signal">文書ホルダー</p>
          <h1 className="text-lg font-semibold text-ink">発注書を撮る</h1>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          <Link
            href="/documents?type=purchase_order"
            className="font-medium text-signal transition-colors hover:text-ink"
          >
            ホルダー
          </Link>
          <Link href="/" className="font-medium text-signal transition-colors hover:text-ink">
            ←戻る
          </Link>
        </div>
      </div>

      {/* Camera section */}
      <section className="space-y-3 rounded-lg border border-line bg-white p-4">
        <div>
          <h2 className="text-sm font-bold text-ink">
            {pages.length === 0 ? "1ページ目を撮影" : `${pages.length + 1}ページ目を撮影`}
          </h2>
          <p className="mt-1 text-xs text-ink-soft">最大{MAX_PAGES}ページまで撮影できます。</p>
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

        <div className="space-y-2">
          {!showLiveCamera && (
            <button
              type="button"
              onClick={() => void startCamera()}
              disabled={busy || pages.length >= MAX_PAGES}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-line bg-paper px-4 py-3 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
            >
              <Camera className="h-4 w-4 text-signal" strokeWidth={1.75} />
              {pages.length === 0 ? "カメラを起動する" : "次のページを撮る"}
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

      {/* Thumbnail strip */}
      {pages.length > 0 && (
        <section className="space-y-3 rounded-lg border border-line bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">
              撮影済み（{pages.length}ページ）
            </h2>
            {pages.length < MAX_PAGES && cameraState === "idle" && (
              <button
                type="button"
                onClick={() => void startCamera()}
                disabled={busy}
                className="inline-flex items-center gap-1 text-xs font-medium text-signal hover:text-ink disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                ページを追加
              </button>
            )}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {pages.map((page, index) => (
              <div key={index} className="relative w-20 shrink-0">
                <div className="overflow-hidden rounded-md border border-line bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={page.previewUrl}
                    alt={`ページ ${index + 1}`}
                    className="aspect-3/4 w-full object-contain"
                  />
                </div>
                <span className="block bg-white px-1 py-0.5 text-center text-xs font-medium text-ink">
                  P{index + 1}
                </span>
                {pages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDeletePage(index)}
                    disabled={busy}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-alert text-white shadow disabled:opacity-50"
                    aria-label={`P${index + 1}を削除`}
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={2} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

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
