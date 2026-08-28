"use client";

import Link from "next/link";
import { Camera, Send, Tag } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { applyTiltReading, captureHandheldFrame, mountFromDeviceTilt, type MountOrientation } from "@/lib/capture/captureFrameFromVideo";
import {
  DEFAULT_PICTURE_PRIORITY,
  PICTURE_PRIORITIES,
  PICTURE_PRIORITY_LABELS,
  picturePriorityLabel,
  type PicturePriority,
} from "@/lib/picture-sends/priority";
import {
  SubjectManageModal,
  type PictureSendSubject,
} from "./SubjectManageModal";

interface SendPictureFormProps {
  userId: string;
  userEmail: string;
}

type CameraState = "idle" | "starting" | "ready" | "denied" | "unsupported" | "error";
type SendStatus = "idle" | "sending" | "done" | "error";

type PictureSendRow = {
  id: string;
  user_email: string;
  subject_text: string;
  body_text: string;
  priority: PicturePriority;
  storage_path: string;
  created_at: string;
};

type RecentSend = PictureSendRow & {
  thumbnailUrl: string | null;
};

const OTHER_SUBJECT_VALUE = "__other__";
const RECENT_LIMIT = 5;

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

async function requestMotionPermission(): Promise<void> {
  try {
    const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DOE.requestPermission === "function") {
      await DOE.requestPermission();
    }
  } catch {
    // Permission denied: shutter falls back to screen orientation.
  }
}

export function SendPictureForm({ userId, userEmail }: SendPictureFormProps) {
  const supabase = createClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const tiltMountRef = useRef<MountOrientation | null>(null);
  const tiltListenFromRef = useRef(0);
  const landscapeStreakRef = useRef(0);
  const onDeviceOrientationRef = useRef((event: DeviceOrientationEvent) => {
    if (Date.now() < tiltListenFromRef.current) return;
    const reading = mountFromDeviceTilt(event.gamma, event.beta);
    const next = applyTiltReading(
      reading,
      landscapeStreakRef.current,
      tiltMountRef.current
    );
    landscapeStreakRef.current = next.landscapeStreak;
    tiltMountRef.current = next.tilt;
  });

  const [subjects, setSubjects] = useState<PictureSendSubject[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [adHocSubject, setAdHocSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [priority, setPriority] = useState<PicturePriority>(DEFAULT_PICTURE_PRIORITY);

  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [sendError, setSendError] = useState<string | null>(null);

  const [recentSends, setRecentSends] = useState<RecentSend[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const isOtherSubject = selectedSubjectId === OTHER_SUBJECT_VALUE;

  const revokePreviewUrl = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const setPreviewFromBlob = useCallback(
    (blob: Blob) => {
      revokePreviewUrl();
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewBlob(blob);
      setPreviewUrl(url);
    },
    [revokePreviewUrl]
  );

  const clearPreview = useCallback(() => {
    revokePreviewUrl();
    setPreviewBlob(null);
    setPreviewUrl(null);
  }, [revokePreviewUrl]);

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

  const loadSubjects = useCallback(async () => {
    setSubjectsLoading(true);
    const { data, error } = await supabase
      .from("picture_send_subjects")
      .select("id, label, created_at, updated_at")
      .order("label");

    if (error) {
      console.error("load subjects failed", error);
      setSubjects([]);
    } else {
      setSubjects(data ?? []);
    }
    setSubjectsLoading(false);
  }, [supabase]);

  const loadRecentSends = useCallback(async () => {
    setRecentLoading(true);
    const { data, error } = await supabase
      .from("picture_sends")
      .select("id, user_email, subject_text, body_text, priority, storage_path, created_at")
      .order("created_at", { ascending: false })
      .limit(RECENT_LIMIT);

    if (error) {
      console.error("load recent sends failed", error);
      setRecentSends([]);
      setRecentLoading(false);
      return;
    }

    const rows = data ?? [];
    const withUrls = await Promise.all(
      rows.map(async (row) => {
        const { data: signed } = await supabase.storage
          .from("picture-sends")
          .createSignedUrl(row.storage_path, 3600);
        return {
          ...row,
          thumbnailUrl: signed?.signedUrl ?? null,
        };
      })
    );

    setRecentSends(withUrls);
    setRecentLoading(false);
  }, [supabase]);

  useEffect(() => {
    void loadSubjects();
    void loadRecentSends();
  }, [loadSubjects, loadRecentSends]);

  useEffect(() => {
    return () => {
      stopCamera();
      revokePreviewUrl();
    };
  }, [stopCamera, revokePreviewUrl]);

  const startCamera = useCallback(async () => {
    setCameraState("starting");
    setCameraError(null);
    clearPreview();
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
        setCameraError(
          err instanceof Error ? err.message : "カメラの起動に失敗しました"
        );
      }
    }
  }, [clearPreview, stopCamera]);

  function handleShutter() {
    const video = videoRef.current;
    if (!video || cameraState !== "ready") return;

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      setSendError("映像の準備ができていません。少し待ってから再度お試しください。");
      return;
    }

    let canvas: HTMLCanvasElement;
    try {
      canvas = captureHandheldFrame(video, tiltMountRef.current);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "画像の生成に失敗しました。");
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setSendError("画像の生成に失敗しました。");
          return;
        }
        setPreviewFromBlob(blob);
        stopCamera();
        setCameraState("idle");
      },
      "image/jpeg",
      0.92
    );
  }

  function resolveSubject(): { subjectId: string | null; subjectText: string } | null {
    if (!selectedSubjectId) {
      setSendError("件名を選択してください。");
      return null;
    }

    if (isOtherSubject) {
      const trimmed = adHocSubject.trim();
      if (!trimmed) {
        setSendError("件名を入力してください。");
        return null;
      }
      return { subjectId: null, subjectText: trimmed };
    }

    const subject = subjects.find((s) => s.id === selectedSubjectId);
    if (!subject) {
      setSendError("選択した件名が見つかりません。再選択してください。");
      return null;
    }

    return { subjectId: subject.id, subjectText: subject.label };
  }

  async function handleSend() {
    setSendError(null);

    if (!previewBlob) {
      setSendError("送信する画像がありません。撮影してください。");
      return;
    }

    const subject = resolveSubject();
    if (!subject) return;

    setSendStatus("sending");

    try {
      const dateSegment = new Date().toISOString().slice(0, 10);
      const path = `${userId}/${dateSegment}/${crypto.randomUUID()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("picture-sends")
        .upload(path, previewBlob, { contentType: "image/jpeg" });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase.from("picture_sends").insert({
        user_id: userId,
        user_email: userEmail,
        subject_id: subject.subjectId,
        subject_text: subject.subjectText,
        body_text: bodyText,
        priority,
        storage_path: path,
      });

      if (insertError) throw insertError;

      setSendStatus("done");
      setSelectedSubjectId("");
      setAdHocSubject("");
      setBodyText("");
      setPriority(DEFAULT_PICTURE_PRIORITY);
      clearPreview();
      stopCamera();
      setCameraState("idle");
      void loadRecentSends();
    } catch (err) {
      console.error("picture send failed", err);
      setSendStatus("error");
      setSendError(err instanceof Error ? err.message : "送信に失敗しました。");
    }
  }

  const showLiveCamera = cameraState === "starting" || cameraState === "ready";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 p-6 pb-12">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">画像送信</h1>
        <div className="flex shrink-0 items-center gap-3 text-sm">
          <Link
            href="/send_picture_album"
            className="font-medium text-signal transition-colors hover:text-ink"
          >
            アルバムを見る
          </Link>
          <Link
            href="/"
            className="font-medium text-signal transition-colors hover:text-ink"
          >
            ←戻る
          </Link>
        </div>
      </div>

      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-ink">件名</span>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-md border border-line bg-white p-1.5 text-signal transition hover:border-signal/50 hover:bg-signal-soft"
              aria-label="ID登録"
              title="ID登録"
            >
              <Tag className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </span>
          <select
            value={selectedSubjectId}
            onChange={(e) => {
              setSelectedSubjectId(e.target.value);
              setSendError(null);
            }}
            disabled={subjectsLoading || sendStatus === "sending"}
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-50"
          >
            <option value="">選択してください</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.label}
              </option>
            ))}
            <option value={OTHER_SUBJECT_VALUE}>（その他・都度入力）</option>
          </select>
        </label>

        {isOtherSubject && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink">件名（都度入力）</span>
            <input
              type="text"
              value={adHocSubject}
              onChange={(e) => setAdHocSubject(e.target.value)}
              placeholder="例: ○○について"
              disabled={sendStatus === "sending"}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-50"
            />
          </label>
        )}

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-ink">本文</span>
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={4}
            placeholder="メモや報告内容を入力"
            disabled={sendStatus === "sending"}
            className="w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-50"
          />
        </label>
      </div>

      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <legend className="float-left mr-1 w-auto p-0 text-sm font-medium text-ink">
          優先度：
        </legend>
        {PICTURE_PRIORITIES.map((value) => (
          <label key={value} className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-ink">
            <input
              type="radio"
              name="picture-priority"
              value={value}
              checked={priority === value}
              onChange={() => setPriority(value)}
              disabled={sendStatus === "sending"}
              className="accent-signal"
            />
            <span>{PICTURE_PRIORITY_LABELS[value]}</span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => void startCamera()}
          disabled={cameraState === "starting" || sendStatus === "sending"}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-line bg-white px-4 py-3 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
        >
          <Camera className="h-4 w-4 text-signal" strokeWidth={1.75} />
          {cameraState === "starting" ? "カメラ起動中..." : "画像撮影"}
        </button>

        {(showLiveCamera || previewUrl) && (
          <div className="overflow-hidden rounded-lg border border-line bg-black">
            <div className="relative aspect-[3/4] w-full bg-black">
              {showLiveCamera && (
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className={`h-full w-full object-cover ${
                    cameraState === "ready" ? "opacity-100" : "opacity-0"
                  }`}
                />
              )}
              {previewUrl && !showLiveCamera && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="撮影プレビュー"
                  className="h-full w-full object-contain"
                />
              )}
              {showLiveCamera && cameraState === "starting" && (
                <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
                  <p className="text-sm text-white/90">カメラを起動しています...</p>
                </div>
              )}
            </div>
          </div>
        )}

        {cameraState === "ready" && (
          <button
            type="button"
            onClick={handleShutter}
            className="w-full rounded-md bg-ink px-4 py-3 text-sm font-medium text-white transition hover:bg-ink/90"
          >
            シャッター
          </button>
        )}

        {(cameraState === "denied" ||
          cameraState === "unsupported" ||
          cameraState === "error") && (
          <>
            {cameraError && (
              <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{cameraError}</p>
            )}
            <button
            type="button"
            onClick={() => void startCamera()}
            className="w-full rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal/50"
          >
            カメラを再試行
            </button>
          </>
        )}

        {previewUrl && (
          <button
            type="button"
            onClick={() => {
              clearPreview();
              void startCamera();
            }}
            disabled={sendStatus === "sending"}
            className="w-full rounded-md border border-line bg-white px-4 py-2 text-sm text-ink transition hover:border-signal/50 disabled:opacity-50"
          >
            撮り直す
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => void handleSend()}
        disabled={sendStatus === "sending" || !previewBlob}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-signal px-4 py-3 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Send className="h-4 w-4" strokeWidth={1.75} />
        {sendStatus === "sending" ? "送信中..." : "送信"}
      </button>

      {sendStatus === "done" && (
        <p className="rounded-md bg-signal/10 px-3 py-2 text-sm text-signal">
          送信が完了しました。
        </p>
      )}

      {(sendStatus === "error" || sendError) && sendStatus !== "done" && (
        <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
          {sendError ?? "エラーが発生しました。もう一度お試しください。"}
        </p>
      )}

      <section className="border-t border-line pt-6">
        <h2 className="text-sm font-bold text-ink">直近の送信</h2>
        <p className="mt-1 text-xs text-ink-soft">最新 {RECENT_LIMIT} 件（自分の送信のみ）</p>

        {recentLoading && (
          <p className="mt-4 text-sm text-ink-soft">読み込み中...</p>
        )}

        {!recentLoading && recentSends.length === 0 && (
          <p className="mt-4 text-sm text-ink-soft">まだ送信がありません。</p>
        )}

        <ul className="mt-4 space-y-3">
          {recentSends.map((send) => (
            <li
              key={send.id}
              className="flex gap-3 rounded-md border border-line bg-white p-3"
            >
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-line">
                {send.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={send.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-soft">
                    画像なし
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink-soft">
                  {formatTimestamp(send.created_at)}
                  <span className="ml-2">優先度：{picturePriorityLabel(send.priority)}</span>
                </p>
                <p className="mt-0.5 truncate text-sm font-medium text-ink">
                  {send.subject_text}
                </p>
                {send.body_text && (
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {truncate(send.body_text, 60)}
                  </p>
                )}
                <p className="mt-1 text-[11px] text-ink-soft">{send.user_email}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <SubjectManageModal
        open={modalOpen}
        userId={userId}
        onClose={() => setModalOpen(false)}
        onSubjectsChanged={() => void loadSubjects()}
      />
    </div>
  );
}
