"use client";

import Link from "next/link";
import { Bell, CircleHelp, FileText, History, ImageIcon, Images, ListChecks, Loader2, Play, Settings, Square, Trash2, Wand2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildMonitorPrompt } from "@/lib/monitor/buildMonitorPrompt";
import { ZoneEditor } from "./ZoneEditor";
import type { MonitorTickResponse } from "@/lib/monitor/runMonitorTick";
import type {
  MonitorSeverity,
  MonitorUserSettings,
  SystemMonitorTemplate,
} from "@/lib/monitor/types";
import {
  archiveCurrentSession,
  clearCurrentEvents,
  deleteSavedSession,
  formatSessionRangeLabel,
  type MonitorSession,
  type MonitorSessionDeps,
  restoreSessionToCurrent,
  type StopChoice,
  planStopAction,
} from "@/lib/monitor/monitorSession";
import {
  resolveHistoryFilesButtonVisible,
  resolveStartButtonState,
} from "@/lib/monitor/monitorButtonState";

const SLOT_COUNT = 10;
const TICK_INTERVAL_MS = 5_000;
const IMAGE_PAGE_SIZE = 80;
const PROCESSED_ALL = "all";
const PROCESSED_UNPROCESSED = "unprocessed";
const PROCESSED_DONE = "processed";
const HISTORY_ALL = "all";
const HISTORY_EVENTS_ONLY = "events";

type TabId = "zones" | "settings" | "status" | "history" | "images";
type ProcessedFilter =
  | typeof PROCESSED_ALL
  | typeof PROCESSED_UNPROCESSED
  | typeof PROCESSED_DONE;
type HistoryFilter = typeof HISTORY_ALL | typeof HISTORY_EVENTS_ONLY;

/** 各タブの「ミニ説明」モーダルに表示する、専門用語を避けた平易な説明文。 */
const TAB_HELP_CONTENT: Record<TabId, { title: string; body: string[] }> = {
  zones: {
    title: "監視ゾーンの設定 とは",
    body: [
      "カメラの映像の中で「ここだけを見張りたい」という範囲を、四角い枠で指定する画面です。",
      "例えば広い駐車場の中の1台分のスペースだけをチェックしたいときに、その部分だけを枠で囲んでおくと、そこだけを比べて変化を調べられます。",
      "枠は1つだけでなく、いくつでも指定できます。複数の場所を同時に見張りたいときは、必要な数だけ枠を追加してください。",
      "枠を何も指定しなければ、画像全体をそのまま比較の対象にします。",
    ],
  },
  settings: {
    title: "監視条件の設定 とは",
    body: [
      "AIに「何を」「どんな基準で」チェックしてほしいかを、日本語の文章で伝えるための設定画面です。",
      "「テンプレート」を選べば、よくある使い方（駐車場の空き確認など）がすぐ使える形で入ります。「白紙から作成」を選べば、自分の言葉で条件を一から書けます。",
      "ここで入力した内容は、そのままAIへの指示文の材料になります。",
    ],
  },
  status: {
    title: "監視状況 とは",
    body: [
      "今、監視がどのように動いているかを確認する画面です。",
      "「監視の開始」を押すと、5秒おきに新しい画像とその一つ前の画像を見比べ、変化があるかをAIが判定します。",
      "直近の判定結果（変化なし・軽微な変化・通知対象）と、実際に比較した2枚の画像がここに表示されます。",
    ],
  },
  history: {
    title: "アクティブ履歴 とは",
    body: [
      "これまでの監視処理の記録（ログ）を一覧で確認できる画面です。",
      "「変化があった」と判定されたものだけに絞って見たり、処理はしたが変化がなかったものまで含めて見たりを切り替えられます。",
      "「履歴フォルダーを見る」を使うと、過去に保存した監視の記録をまとめて呼び出して見返すこともできます。",
    ],
  },
  images: {
    title: "画像表示 とは",
    body: [
      "自動撮影で保存された画像を、一覧のサムネイルで確認できる画面です。",
      "「未処理のみ」「処理済のみ」で絞り込むと、AIがまだチェックしていない画像や、すでにチェックが終わった画像だけを見つけやすくなります。",
      "画像をクリックすると、大きく表示して撮影日時なども確認できます。",
    ],
  },
};

type MonitorAnalyzeViewProps = {
  tenantId: string;
  userId: string;
};

/** "waiting" は画面上だけの一時的な表示用（未処理画像なし）で、DBには保存されない。 */
type MonitorEvent = {
  id: string;
  severity: MonitorSeverity | "waiting";
  diff_score: number | null;
  ai_summary: string | null;
  email_queued: boolean;
  analysis_tool: string | null;
  created_at: string;
  prev_capture_id?: string | null;
  curr_capture_id?: string | null;
  prev_capture_no?: number | null;
  curr_capture_no?: number | null;
};

const WAITING_EVENT_ID = "client-waiting-placeholder";

function makeWaitingEvent(): MonitorEvent {
  return {
    id: WAITING_EVENT_ID,
    severity: "waiting",
    diff_score: null,
    ai_summary: "処理する画像がありません",
    email_queued: false,
    analysis_tool: null,
    created_at: new Date().toISOString(),
    prev_capture_id: null,
    curr_capture_id: null,
    prev_capture_no: null,
    curr_capture_no: null,
  };
}

type EventCompareModal = {
  prevNo: number | null;
  currNo: number | null;
  prevUrl: string | null;
  currUrl: string | null;
  loading: boolean;
  error: string | null;
};

type SavedSession = MonitorSession & { logCount: number; imageCount: number };

type AutoCaptureRow = {
  id: string;
  storage_path: string;
  created_at: string;
  processed_at: string | null;
};

type CaptureImage = AutoCaptureRow & {
  signedUrl: string | null;
  imageNo: number | null;
};

const emptySlots = () => Array.from({ length: SLOT_COUNT }, () => "");
const defaultLabels = () =>
  Array.from({ length: SLOT_COUNT }, (_, index) => `項目${index + 1}`);

function normalizeSlots(values: string[] | undefined): string[] {
  return Array.from({ length: SLOT_COUNT }, (_, index) => values?.[index] ?? "");
}

function normalizeLabels(values: string[] | undefined): string[] {
  return Array.from({ length: SLOT_COUNT }, (_, index) => {
    const value = values?.[index]?.trim();
    return value ? value : `項目${index + 1}`;
  });
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function severityLabel(severity: MonitorSeverity | "waiting" | null): string {
  if (severity === "notify") return "通知対象";
  if (severity === "minor") return "軽微な変化";
  if (severity === "skip") return "変化なし";
  return "待機中";
}

function severityColor(severity: MonitorSeverity | "waiting"): string {
  if (severity === "notify") return "bg-red-600";
  if (severity === "minor") return "bg-yellow-400";
  if (severity === "waiting") return "bg-ink-soft";
  return "bg-emerald-500";
}

function isChangeEvent(severity: MonitorSeverity | "waiting"): boolean {
  return severity === "minor" || severity === "notify";
}

function MiniHelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:border-signal/50 hover:text-ink"
    >
      <CircleHelp className="h-3.5 w-3.5" strokeWidth={1.75} />
      ミニ説明
    </button>
  );
}

export function MonitorAnalyzeView({ tenantId, userId }: MonitorAnalyzeViewProps) {
  const supabase = useMemo(() => createClient(), []);

  const [activeTab, setActiveTab] = useState<TabId>("zones");
  const [templates, setTemplates] = useState<SystemMonitorTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [slotLabels, setSlotLabels] = useState<string[]>(defaultLabels);
  const [slotValues, setSlotValues] = useState<string[]>(emptySlots);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [meaningModalOpen, setMeaningModalOpen] = useState(false);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [tabHelpModalOpen, setTabHelpModalOpen] = useState<TabId | null>(null);
  const [eventCompareModal, setEventCompareModal] = useState<EventCompareModal | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const [monitoring, setMonitoring] = useState(false);
  const [monitoringStartedAt, setMonitoringStartedAt] = useState<string | null>(null);
  const [lastSeverity, setLastSeverity] = useState<MonitorSeverity | null>(null);
  const [lastDiffScore, setLastDiffScore] = useState<number | null>(null);
  const [lastMessage, setLastMessage] = useState("監視を開始すると5秒ごとに解析します。");
  const [monitorCount, setMonitorCount] = useState(0);
  const [prevImageNo, setPrevImageNo] = useState<number | null>(null);
  const [currImageNo, setCurrImageNo] = useState<number | null>(null);
  const [prevImageUrl, setPrevImageUrl] = useState<string | null>(null);
  const [currImageUrl, setCurrImageUrl] = useState<string | null>(null);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [tickRunning, setTickRunning] = useState(false);
  const [tickError, setTickError] = useState<string | null>(null);

  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [stopChoice, setStopChoice] = useState<StopChoice>("pause");
  const [monitoringLocked, setMonitoringLocked] = useState(false);
  const [historyViewMode, setHistoryViewMode] = useState(false);
  // 「履歴フォルダーを見る」で復元中の履歴フォルダーの日時情報。
  // historyViewMode中、アクティブ履歴・画像表示タブの上部に表示する案内バナーに使う。
  const [restoredSession, setRestoredSession] = useState<MonitorSession | null>(null);
  const [historyListModalOpen, setHistoryListModalOpen] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [historyFilesLoading, setHistoryFilesLoading] = useState(false);
  // 復元(Storageコピー+RPC)は処理時間がかかることがあるため、
  // どのセッションを処理中か保持してスピナー表示・他行の操作抑止に使う。
  const [restoringSessionId, setRestoringSessionId] = useState<string | null>(null);
  const [historyFilesError, setHistoryFilesError] = useState<string | null>(null);

  const [processedFilter, setProcessedFilter] = useState<ProcessedFilter>(PROCESSED_ALL);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>(HISTORY_EVENTS_ONLY);
  const [images, setImages] = useState<CaptureImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<CaptureImage | null>(null);

  const lastCurrCaptureIdRef = useRef<string | null>(null);
  const tickInFlightRef = useRef(false);
  /** 実行中のtickのPromise（停止時に完了を待ち合わせるため）。 */
  const tickPromiseRef = useRef<Promise<void> | null>(null);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const currentPromptText = useMemo(
    () =>
      buildMonitorPrompt({
        title: title.trim() || "（タイトル未設定）",
        labels: normalizeLabels(slotLabels),
        values: slotValues,
      }),
    [slotLabels, slotValues, title]
  );

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const res = await fetch("/api/monitor/events", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "イベント一覧の読み込みに失敗しました");
      setEvents(body as MonitorEvent[]);
    } catch (err) {
      console.error("load monitor events failed", err);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  // /capture_auto と同様、画面を開くたびに自分の古い「現在」アクティブ履歴を
  // クリアする（ベストエフォート。失敗しても画面の表示は続行する）。
  // アーカイブ済み（session_id が付いた）履歴フォルダーはここでは消さない。
  const clearOwnMonitorEvents = useCallback(async () => {
    try {
      const { error } = await supabase
        .from("monitor_change_events")
        .delete()
        .eq("user_id", userId)
        .is("session_id", null);
      if (error) throw error;
    } catch (err) {
      console.error("clearOwnMonitorEvents failed", err);
    }
  }, [supabase, userId]);

  const openEventCompare = useCallback(
    async (event: MonitorEvent) => {
      if (!event.prev_capture_id || !event.curr_capture_id) return;

      setEventCompareModal({
        prevNo: event.prev_capture_no ?? null,
        currNo: event.curr_capture_no ?? null,
        prevUrl: null,
        currUrl: null,
        loading: true,
        error: null,
      });

      try {
        const [{ data: prevRow, error: prevError }, { data: currRow, error: currError }] =
          await Promise.all([
            supabase
              .from("auto_captures")
              .select("id, storage_path")
              .eq("id", event.prev_capture_id)
              .maybeSingle(),
            supabase
              .from("auto_captures")
              .select("id, storage_path")
              .eq("id", event.curr_capture_id)
              .maybeSingle(),
          ]);

        if (prevError) throw prevError;
        if (currError) throw currError;
        if (!prevRow?.storage_path || !currRow?.storage_path) {
          throw new Error("比較画像が見つかりません");
        }

        const [prevSigned, currSigned] = await Promise.all([
          supabase.storage.from("auto-captures").createSignedUrl(prevRow.storage_path, 3600),
          supabase.storage.from("auto-captures").createSignedUrl(currRow.storage_path, 3600),
        ]);

        setEventCompareModal({
          prevNo: event.prev_capture_no ?? null,
          currNo: event.curr_capture_no ?? null,
          prevUrl: prevSigned.data?.signedUrl ?? null,
          currUrl: currSigned.data?.signedUrl ?? null,
          loading: false,
          error: null,
        });
      } catch (err) {
        setEventCompareModal({
          prevNo: event.prev_capture_no ?? null,
          currNo: event.curr_capture_no ?? null,
          prevUrl: null,
          currUrl: null,
          loading: false,
          error: err instanceof Error ? err.message : "画像の読み込みに失敗しました",
        });
      }
    },
    [supabase]
  );

  const attachSignedUrls = useCallback(
    async (
      rows: AutoCaptureRow[],
      ordinalById: Map<string, number>
    ): Promise<CaptureImage[]> => {
      return Promise.all(
        rows.map(async (row) => {
          const { data } = await supabase.storage
            .from("auto-captures")
            .createSignedUrl(row.storage_path, 3600);
          return {
            ...row,
            signedUrl: data?.signedUrl ?? null,
            imageNo: ordinalById.get(row.id) ?? null,
          };
        })
      );
    },
    [supabase]
  );

  const loadImages = useCallback(async () => {
    setImagesLoading(true);
    setImagesError(null);

    let query = supabase
      .from("auto_captures")
      .select("id, storage_path, created_at, processed_at")
      .eq("tenant_id", tenantId)
      .eq("captured_by", userId)
      .order("created_at", { ascending: false })
      .limit(IMAGE_PAGE_SIZE);

    if (processedFilter === PROCESSED_UNPROCESSED) {
      query = query.is("processed_at", null);
    } else if (processedFilter === PROCESSED_DONE) {
      query = query.not("processed_at", "is", null);
    }

    const { data, error } = await query;
    if (error) {
      setImagesError(error.message);
      setImages([]);
      setImagesLoading(false);
      return;
    }

    const rows = (data ?? []) as AutoCaptureRow[];
    const { data: orderedIds, error: orderError } = await supabase
      .from("auto_captures")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("captured_by", userId)
      .order("created_at", { ascending: true });

    if (orderError) {
      setImagesError(orderError.message);
      setImages([]);
      setImagesLoading(false);
      return;
    }

    const ordinalById = new Map<string, number>(
      (orderedIds ?? []).map((row, index) => [row.id as string, index + 1])
    );
    const withUrls = await attachSignedUrls(rows, ordinalById);
    setImages(withUrls);
    setImagesLoading(false);
  }, [attachSignedUrls, processedFilter, supabase, tenantId, userId]);

  const monitorSessionDeps = useMemo<MonitorSessionDeps>(
    () => ({
      generateId: () => crypto.randomUUID(),

      async listActiveCaptures({ tenantId, userId: ownerId }) {
        const { data, error } = await supabase
          .from("auto_captures")
          .select("id, storage_path, created_at")
          .eq("tenant_id", tenantId)
          .eq("captured_by", ownerId);
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => ({
          captureId: row.id as string,
          storagePath: row.storage_path as string,
          createdAt: row.created_at as string,
        }));
      },

      async copyStorageObjects(mappings) {
        for (const { fromPath, toPath } of mappings) {
          const { error } = await supabase.storage
            .from("auto-captures")
            .copy(fromPath, toPath);
          if (error) throw new Error(error.message);
        }
      },

      async archiveSession({ sessionId, tenantId, userId: ownerId, startedAt, stoppedAt, captureMap }) {
        const { error } = await supabase.rpc("archive_current_session", {
          p_session_id: sessionId,
          p_tenant_id: tenantId,
          p_user_id: ownerId,
          p_started_at: startedAt,
          p_stopped_at: stoppedAt,
          p_capture_path_map: captureMap.map((mapping) => ({
            old_capture_id: mapping.oldCaptureId,
            new_storage_path: mapping.newStoragePath,
          })),
        });
        if (error) throw new Error(error.message);
      },

      async listSavedSessions(ownerId): Promise<MonitorSession[]> {
        const { data, error } = await supabase
          .from("monitor_sessions")
          .select("id, started_at, stopped_at")
          .eq("user_id", ownerId)
          .order("started_at", { ascending: false });
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => ({
          id: row.id as string,
          startedAt: row.started_at as string,
          stoppedAt: row.stopped_at as string,
        }));
      },

      async listSessionCaptures(sessionId) {
        const { data, error } = await supabase
          .from("monitor_session_captures")
          .select("id, storage_path, created_at")
          .eq("session_id", sessionId);
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => ({
          captureId: row.id as string,
          storagePath: row.storage_path as string,
          createdAt: row.created_at as string,
        }));
      },

      async restoreSession({ sessionId, tenantId, userId: ownerId, captureMap }) {
        const { error } = await supabase.rpc("restore_session_to_current", {
          p_session_id: sessionId,
          p_tenant_id: tenantId,
          p_user_id: ownerId,
          p_capture_map: captureMap.map((mapping) => ({
            old_capture_id: mapping.oldCaptureId,
            new_capture_id: mapping.newCaptureId,
            new_storage_path: mapping.newStoragePath,
          })),
        });
        if (error) throw new Error(error.message);
      },

      async deleteCurrentEvents(ownerId) {
        // session_id is null の条件は、旧方式（タグ付け）で保存された履歴フォルダー用の
        // 行がまだ残っている過渡期の安全策。新規イベントは常にsession_id nullで
        // 作られるため、移行完了後にsession_id列自体を削除すればこの条件も不要になる。
        const { data, error } = await supabase
          .from("monitor_change_events")
          .delete()
          .eq("user_id", ownerId)
          .is("session_id", null)
          .select("prev_capture_id, curr_capture_id");
        if (error) throw new Error(error.message);
        return (data ?? []).map((row) => ({
          prevCaptureId: row.prev_capture_id as string,
          currCaptureId: row.curr_capture_id as string,
        }));
      },

      async deleteCaptureIfUnreferenced(captureId) {
        const { data, error } = await supabase.rpc("delete_capture_if_unreferenced", {
          p_capture_id: captureId,
        });
        if (error) {
          console.error("deleteCaptureIfUnreferenced failed", error);
          return false;
        }
        if (!data) return false;
        await supabase.storage.from("auto-captures").remove([data as string]);
        return true;
      },

      async deleteSession(sessionId) {
        const { error } = await supabase
          .from("monitor_sessions")
          .delete()
          .eq("id", sessionId);
        if (error) throw new Error(error.message);
      },

      async removeStorageObjects(paths) {
        if (paths.length === 0) return;
        const { error } = await supabase.storage.from("auto-captures").remove(paths);
        if (error) throw new Error(error.message);
      },
    }),
    [supabase]
  );

  // 履歴フォルダー一覧では、monitorSessionDeps.listSavedSessions（MonitorSession[]を
  // 返す既存の共通インターフェース）とは別に、表示用のログ件数・画像枚数も
  // まとめて取得する。monitor_change_eventsをsession_idでグルーピングし、
  // ログ件数はイベント行数、画像枚数はprev/curr_capture_idの重複を除いた件数とする。
  const loadSavedSessionsWithCounts = useCallback(
    async (ownerId: string): Promise<SavedSession[]> => {
      const { data: sessionRows, error: sessionsError } = await supabase
        .from("monitor_sessions")
        .select("id, started_at, stopped_at")
        .eq("user_id", ownerId)
        .order("started_at", { ascending: false });
      if (sessionsError) throw new Error(sessionsError.message);

      // 1リクエストの上限行数（PostgRESTのmax_rows等）を超えるユーザーでも
      // 件数が黙って欠落しないよう、.range()でページングして全件取得する。
      const PAGE_SIZE = 1000;
      type EventCountRow = {
        session_id: string;
        prev_capture_id: string | null;
        curr_capture_id: string | null;
      };
      const eventRows: EventCountRow[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data: page, error: pageError } = await supabase
          .from("monitor_session_events")
          .select("session_id, prev_capture_id, curr_capture_id")
          .eq("user_id", ownerId)
          .range(from, from + PAGE_SIZE - 1);
        if (pageError) throw new Error(pageError.message);
        const rows = (page ?? []) as EventCountRow[];
        eventRows.push(...rows);
        if (rows.length < PAGE_SIZE) break;
      }

      const countsBySession = new Map<
        string,
        { logCount: number; captureIds: Set<string> }
      >();
      for (const row of eventRows) {
        const sessionId = row.session_id;
        const entry =
          countsBySession.get(sessionId) ?? { logCount: 0, captureIds: new Set<string>() };
        entry.logCount += 1;
        if (row.prev_capture_id) entry.captureIds.add(row.prev_capture_id);
        if (row.curr_capture_id) entry.captureIds.add(row.curr_capture_id);
        countsBySession.set(sessionId, entry);
      }

      return (sessionRows ?? []).map((row) => {
        const counts = countsBySession.get(row.id as string);
        return {
          id: row.id as string,
          startedAt: row.started_at as string,
          stoppedAt: row.stopped_at as string,
          logCount: counts?.logCount ?? 0,
          imageCount: counts?.captureIds.size ?? 0,
        };
      });
    },
    [supabase]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      setSettingsLoading(true);
      setSettingsError(null);
      try {
        const [settingsRes, templatesRes] = await Promise.all([
          fetch("/api/monitor/settings", { cache: "no-store" }),
          fetch("/api/monitor/templates", { cache: "no-store" }),
        ]);
        const [settingsBody, templatesBody] = await Promise.all([
          settingsRes.json(),
          templatesRes.json(),
        ]);

        if (!settingsRes.ok) {
          throw new Error(settingsBody?.error ?? "監視設定の読み込みに失敗しました");
        }
        if (!templatesRes.ok) {
          throw new Error(templatesBody?.error ?? "テンプレートの読み込みに失敗しました");
        }
        if (cancelled) return;

        const settings = settingsBody as MonitorUserSettings & { saved?: boolean };
        const loadedTemplates = templatesBody as SystemMonitorTemplate[];
        const hasSavedContent = settings.saved === true;

        setTemplates(loadedTemplates);

        if (hasSavedContent) {
          const matchedTemplate =
            loadedTemplates.find((template) => template.id === settings.templateId) ?? null;
          setTemplateId(matchedTemplate?.id ?? settings.templateId);
          setTitle(settings.title);
          setEmail(settings.email ?? "");
          setSlotLabels(
            settings.slotLabels?.length
              ? normalizeLabels(settings.slotLabels)
              : matchedTemplate
                ? normalizeLabels(matchedTemplate.slots.map((slot) => slot.label))
                : defaultLabels()
          );
          setSlotValues(normalizeSlots(settings.slotValues));
        } else {
          setTemplateId(null);
          setTitle("");
          setEmail("");
          setSlotLabels(defaultLabels());
          setSlotValues(emptySlots());
        }
      } catch (err) {
        setSettingsError(err instanceof Error ? err.message : "初期設定の読み込みに失敗しました");
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    }

    void loadInitialData();
    void (async () => {
      await clearOwnMonitorEvents();
      if (!cancelled) void loadEvents();
    })();

    return () => {
      cancelled = true;
    };
  }, [loadEvents, clearOwnMonitorEvents]);

  useEffect(() => {
    if (activeTab === "images") {
      void loadImages();
    }
    if (activeTab === "history") {
      void loadEvents();
    }
  }, [activeTab, loadEvents, loadImages]);

  const runTick = useCallback(async () => {
    if (tickInFlightRef.current) return;

    tickInFlightRef.current = true;
    setTickRunning(true);
    setTickError(null);

    try {
      const res = await fetch("/api/monitor/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prevCaptureId: lastCurrCaptureIdRef.current,
          title,
          email: email.trim() || null,
          labels: normalizeLabels(slotLabels),
          slotValues: normalizeSlots(slotValues),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "監視処理に失敗しました");

      const result = body as MonitorTickResponse;
      setMonitorCount((count) => count + 1);
      setLastSeverity(result.status === "waiting" ? null : (result.severity ?? "skip"));
      setLastDiffScore(result.diffScore);
      setLastMessage(result.summary || result.message || "監視処理が完了しました");
      setPrevImageUrl(result.prevSignedUrl);
      setCurrImageUrl(result.currSignedUrl);
      setPrevImageNo(result.prevCaptureNo ?? null);
      setCurrImageNo(result.currCaptureNo ?? null);

      if (result.currCaptureId) {
        lastCurrCaptureIdRef.current = result.currCaptureId;
      }
      if (result.status === "waiting") {
        // DBには保存しない、画面上だけの一時的な表示（既存の待機中プレースホルダーは置き換える）。
        setEvents((prev) => [
          makeWaitingEvent(),
          ...prev.filter((event) => event.id !== WAITING_EVENT_ID),
        ]);
      } else if (result.eventId || result.status === "processed" || result.status === "baseline") {
        void loadEvents();
      }
      void loadImages();
    } catch (err) {
      setTickError(err instanceof Error ? err.message : "監視処理に失敗しました");
    } finally {
      tickInFlightRef.current = false;
      setTickRunning(false);
    }
  }, [email, loadEvents, loadImages, slotLabels, slotValues, title]);

  const runTickRef = useRef(runTick);
  runTickRef.current = runTick;

  useEffect(() => {
    if (!monitoring) return;

    const tick = () => {
      // 既にtickが実行中なら、その完了を待っているPromiseを
      // 上書きしない（runTickは即座に解決する空振りのPromiseを返すため、
      // 上書きすると停止時の待ち合わせ(handleConfirmStop)が機能しなくなる）。
      if (tickInFlightRef.current) return;
      const promise = runTickRef.current();
      tickPromiseRef.current = promise;
      void promise.finally(() => {
        if (tickPromiseRef.current === promise) {
          tickPromiseRef.current = null;
        }
      });
    };
    void tick();
    const timerId = window.setInterval(tick, TICK_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [monitoring]);

  function applyTemplate(template: SystemMonitorTemplate) {
    setTemplateId(template.id);
    setTitle(template.title);
    setSlotLabels(normalizeLabels(template.slots.map((slot) => slot.label)));
    setSlotValues(normalizeSlots(template.slots.map((slot) => slot.default_value)));
    setSettingsMessage(`「${template.title}」を反映しました。必要なら項目名・値を編集できます。`);
    setTemplateModalOpen(false);
  }

  function startBlankSettings() {
    setTemplateId(null);
    setTitle("");
    setEmail("");
    setSlotLabels(defaultLabels());
    setSlotValues(emptySlots());
    setSettingsMessage("白紙の監視条件を用意しました。項目名と値を自由に入力してください。");
    setSettingsError(null);
  }

  async function handleSaveSettings() {
    setSettingsSaving(true);
    setSettingsMessage(null);
    setSettingsError(null);
    try {
      const res = await fetch("/api/monitor/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          email: email.trim() || null,
          slotLabels: normalizeLabels(slotLabels),
          slotValues: normalizeSlots(slotValues),
          templateId,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "設定の保存に失敗しました");
      const saved = body as MonitorUserSettings;
      setTitle(saved.title);
      setEmail(saved.email ?? "");
      setSlotLabels(normalizeLabels(saved.slotLabels));
      setSlotValues(normalizeSlots(saved.slotValues));
      setTemplateId(saved.templateId);
      setSettingsMessage("監視条件を保存しました。");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "設定の保存に失敗しました");
    } finally {
      setSettingsSaving(false);
    }
  }

  function handleStartMonitoring() {
    // monitoringStartedAt が既に設定されている＝一時停止からの再開。
    // アーカイブ時の「開始時間」を保つため、また直前の比較画像・カウントを
    // 失わないため、新規開始のときだけ状態を全リセットする。
    const isFreshStart = monitoringStartedAt === null;
    const startedAt = monitoringStartedAt ?? new Date().toISOString();

    setMonitoringStartedAt(startedAt);
    setMonitoring(true);
    setActiveTab("status");
    setTickError(null);

    if (isFreshStart) {
      setLastSeverity(null);
      setLastDiffScore(null);
      setLastMessage("監視を開始しました。次の画像を確認しています。");
      setPrevImageUrl(null);
      setCurrImageUrl(null);
      setPrevImageNo(null);
      setCurrImageNo(null);
      setMonitorCount(0);
      lastCurrCaptureIdRef.current = null;
    } else {
      setLastMessage("監視を再開しました。");
    }
  }

  function openStopModal() {
    setStopChoice("pause");
    setStopModalOpen(true);
  }

  async function handleConfirmStop() {
    const plan = planStopAction(stopChoice);

    setMonitoring(false);
    setStopModalOpen(false);

    // 実行中のtick（画像取得・AI解析）が完了するまで待つ。待たずに停止すると、
    // tickが停止後にイベントをINSERTし、アーカイブの対象から漏れたまま
    // 「現在」プールに取り残される（次回リロードで気づかれずに消える）。
    if (tickPromiseRef.current) {
      await tickPromiseRef.current;
    }

    const startedAt = monitoringStartedAt;
    const stoppedAt = new Date().toISOString();

    if (plan.shouldArchive && startedAt) {
      try {
        await archiveCurrentSession(
          { tenantId, userId, startedAt, stoppedAt },
          monitorSessionDeps
        );
        setLastMessage("監視を終了し、アクティブ履歴・画像を履歴フォルダーに保存しました。");
      } catch (err) {
        // 保存に失敗した場合は「一時停止」相当として扱う。開始ボタンをロックせず、
        // monitoringStartedAt も維持することで、監視を再開してもう一度
        // 「保存して停止」を試せるようにする（イベントを取りこぼさない）。
        setLastMessage(
          err instanceof Error
            ? `履歴の保存に失敗しました: ${err.message}（再開すれば再試行できます）`
            : "履歴の保存に失敗しました。（再開すれば再試行できます）"
        );
        setMonitoringLocked(false);
        return;
      }
    } else if (plan.shouldLockStartButton) {
      setLastMessage("監視を終了しました。");
    } else {
      setLastMessage("監視を一時停止しました。「監視の開始」で再開できます。");
    }

    if (plan.shouldLockStartButton) {
      // 再開不可の停止なので、次に「監視の開始」が有効化される場合は
      // 新規セッションとして扱う。
      setMonitoringStartedAt(null);
    }
    setMonitoringLocked(plan.shouldLockStartButton);
  }

  async function handleOpenHistoryFiles() {
    if (
      !window.confirm(
        "現在のアクティブ履歴・画像は削除されます。よろしいですか？"
      )
    ) {
      return;
    }

    setHistoryFilesError(null);
    setHistoryFilesLoading(true);
    try {
      await clearCurrentEvents(userId, monitorSessionDeps);
      // 現在のイベント・画像を消した以上、直前の監視セッションの「再開」は成立しない
      // （lastCurrCaptureIdRef が指すキャプチャもここで削除され得るため、そのまま
      // 再開すると tick が「前回画像が見つかりません」で回り続ける）。
      // monitoringStartedAt を null に戻すことで、次の handleStartMonitoring が
      // 新規開始パスに入り、カウント・比較画像・lastCurrCaptureIdRef をリセットする。
      setMonitoringStartedAt(null);
      const sessions = await loadSavedSessionsWithCounts(userId);
      setSavedSessions(sessions);
      setHistoryListModalOpen(true);
    } catch (err) {
      setHistoryFilesError(
        err instanceof Error ? err.message : "履歴フォルダーの読み込みに失敗しました"
      );
    } finally {
      // clearCurrentEvents はここまでで既にDB側の削除が反映されている可能性があるため、
      // 以降の一覧取得(listSavedSessions)が失敗した場合でも、画面上のイベント・画像一覧は
      // 必ずDBの最新状態に同期させる。
      void loadEvents();
      void loadImages();
      setHistoryFilesLoading(false);
    }
  }

  async function handleSelectHistorySession(session: MonitorSession) {
    setHistoryFilesError(null);
    setRestoringSessionId(session.id);
    try {
      await restoreSessionToCurrent(session.id, tenantId, userId, monitorSessionDeps);
      setHistoryListModalOpen(false);
      setHistoryViewMode(true);
      setRestoredSession(session);
      void loadEvents();
      void loadImages();
    } catch (err) {
      setHistoryFilesError(
        err instanceof Error ? err.message : "履歴フォルダーの復元に失敗しました"
      );
    } finally {
      setRestoringSessionId(null);
    }
  }

  async function handleDeleteHistorySession(session: MonitorSession) {
    if (
      !window.confirm(
        `「${formatSessionRangeLabel(session)}」の履歴フォルダーを削除しますか？元に戻せません。`
      )
    ) {
      return;
    }

    setHistoryFilesError(null);
    try {
      await deleteSavedSession(session.id, monitorSessionDeps);
      setSavedSessions((prev) => prev.filter((s) => s.id !== session.id));
    } catch (err) {
      setHistoryFilesError(
        err instanceof Error ? err.message : "履歴フォルダーの削除に失敗しました"
      );
    }
  }

  const displayedEvents = useMemo(() => {
    if (historyFilter === HISTORY_ALL) return events;
    return events.filter((event) => isChangeEvent(event.severity));
  }, [events, historyFilter]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-signal" strokeWidth={1.75} />
          <h1 className="text-lg font-semibold text-ink">監視分析</h1>
        </div>
        <Link
          href="/"
          className="shrink-0 text-sm font-medium text-signal transition-colors hover:text-ink"
        >
          ←戻る
        </Link>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        固定撮影で蓄積した画像を、画面を開いている間だけ5秒ごとに比較し、変化をAIで解析します。
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg border border-line bg-white p-1 sm:grid-cols-5">
        <TabButton active={activeTab === "zones"} onClick={() => setActiveTab("zones")}>
          監視ゾーンの設定
        </TabButton>
        <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")}>
          監視条件の設定
        </TabButton>
        <TabButton active={activeTab === "status"} onClick={() => setActiveTab("status")}>
          監視状況
        </TabButton>
        <TabButton active={activeTab === "history"} onClick={() => setActiveTab("history")}>
          アクティブ履歴
        </TabButton>
        <TabButton active={activeTab === "images"} onClick={() => setActiveTab("images")}>
          画像表示
        </TabButton>
      </div>

      {activeTab === "zones" && (
        <section className="mt-5 rounded-lg border border-line bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
              <ImageIcon className="h-4 w-4 text-signal" strokeWidth={1.75} />
              監視ゾーンの設定
            </h2>
            <MiniHelpButton onClick={() => setTabHelpModalOpen("zones")} />
          </div>
          <div className="mt-4">
            <ZoneEditor tenantId={tenantId} userId={userId} />
          </div>
        </section>
      )}

      {activeTab === "settings" && (
        <section className="mt-5 rounded-lg border border-line bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                  <Settings className="h-4 w-4 text-signal" strokeWidth={1.75} />
                  監視条件の設定
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMeaningModalOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:border-signal/50 hover:text-ink"
                  >
                    <CircleHelp className="h-3.5 w-3.5" strokeWidth={1.75} />
                    監視条件を設定する意味
                  </button>
                  <MiniHelpButton onClick={() => setTabHelpModalOpen("settings")} />
                </div>
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                システムテンプレートを使うか、白紙から項目名・値を自分で設定できます。
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={startBlankSettings}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:border-signal/50"
              >
                白紙から作成
              </button>
              <button
                type="button"
                onClick={() => setTemplateModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:border-signal/50"
              >
                <Wand2 className="h-4 w-4" strokeWidth={1.75} />
                テンプレート
              </button>
            </div>
          </div>

          {settingsLoading ? (
            <p className="mt-6 text-sm text-ink-soft">読み込み中...</p>
          ) : (
            <div className="mt-5 space-y-4">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">タイトル</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
                  placeholder="監視タイトル"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium text-ink">メールアドレス</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
                  placeholder="空欄なら通知対象にしない"
                />
                <span className="text-xs text-ink-soft">
                  v1では実メール送信は行わず、通知キューの記録まで行います。
                </span>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                {slotLabels.map((label, index) => (
                  <div key={`slot-${index}`} className="space-y-1.5 rounded-md border border-line p-3">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-ink-soft">項目名 {index + 1}</span>
                      <input
                        value={label}
                        onChange={(e) => {
                          const next = Array.from(
                            { length: SLOT_COUNT },
                            (_, i) => slotLabels[i] ?? ""
                          );
                          next[index] = e.target.value;
                          setSlotLabels(next);
                        }}
                        className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm font-medium outline-none focus:border-signal focus:ring-1 focus:ring-signal"
                        placeholder={`項目${index + 1}`}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-ink-soft">値</span>
                      <input
                        value={slotValues[index] ?? ""}
                        onChange={(e) => {
                          const next = normalizeSlots(slotValues);
                          next[index] = e.target.value;
                          setSlotValues(next);
                        }}
                        className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
                        placeholder="監視内容を入力"
                      />
                    </label>
                  </div>
                ))}
              </div>

              {settingsMessage && (
                <p className="rounded-md bg-signal/10 px-3 py-2 text-sm text-signal">
                  {settingsMessage}
                </p>
              )}
              {settingsError && (
                <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
                  {settingsError}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => void handleSaveSettings()}
                  disabled={settingsSaving}
                  className="ml-auto rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
                >
                  {settingsSaving ? "保存中..." : "設定を保存"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === "status" && (
        <section className="mt-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white p-4">
            <div className="flex min-w-0 items-start gap-3">
              {monitoring && <MonitoringPulse />}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                    <ListChecks className="h-4 w-4 text-signal" strokeWidth={1.75} />
                    監視状況
                    {monitoring && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-signal/10 px-2 py-0.5 text-xs font-medium text-signal">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
                        </span>
                        LIVE
                      </span>
                    )}
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPromptModalOpen(true)}
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:border-signal/50 hover:text-ink"
                    >
                      <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                      命令を表示
                    </button>
                    <MiniHelpButton onClick={() => setTabHelpModalOpen("status")} />
                  </div>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {monitoring ? "監視中（5秒間隔）" : "停止中"}
                  {tickRunning ? " · 処理中..." : ""}
                  {monitoringStartedAt ? ` · 開始 ${formatTimestamp(monitoringStartedAt)}` : ""}
                </p>
                <p className="mt-1 text-sm text-ink">
                  監視カウント: <span className="font-en font-medium">{monitorCount}</span>
                  <span className="text-ink-soft">（監視処理の実行回数）</span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {monitoring ? (
                <button
                  type="button"
                  onClick={openStopModal}
                  className="inline-flex items-center gap-2 rounded-md bg-alert px-4 py-2 text-sm font-medium text-white transition hover:bg-alert/90"
                >
                  <Square className="h-4 w-4" strokeWidth={1.75} />
                  停止・終了
                </button>
              ) : (
                (() => {
                  const startButtonState = resolveStartButtonState({
                    monitoringLocked,
                    historyViewMode,
                  });
                  if (!startButtonState.visible) return null;
                  return (
                    <button
                      type="button"
                      onClick={handleStartMonitoring}
                      disabled={startButtonState.disabled}
                      className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Play className="h-4 w-4" strokeWidth={1.75} />
                      監視の開始
                    </button>
                  );
                })()
              )}
            </div>
          </div>

          {monitoring && (
            <div className="overflow-hidden rounded-lg border border-signal/20 bg-signal/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <MonitoringPulse />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {tickRunning ? "画像を比較・解析しています…" : "次の未処理画像を待機しています…"}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/80">
                    <div className="h-full w-full origin-left animate-pulse rounded-full bg-signal/80" />
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-line bg-white px-4 py-3">
            <div className="flex items-start gap-4 sm:gap-5">
              <LampGroup severity={lastSeverity} />
              <div className="min-w-0 flex-1">
                <ul className="space-y-1 text-left text-xs leading-snug text-ink-soft">
                  <li className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                    <span>緑：変化なし（差分が小さく、AI解析をスキップ）</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-yellow-400" />
                    <span>黄：軽微な変化（記録するが通知はしない）</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-600" />
                    <span>赤：通知対象（大きな変化。メール設定時は通知キューへ）</span>
                  </li>
                </ul>
                <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                  <p className="min-w-0 flex-1 text-left text-sm leading-snug text-ink">{lastMessage}</p>
                  <p className="shrink-0 text-right text-xs leading-snug">
                    <span className="font-medium text-ink-soft">ステータス</span>
                    <span className="ml-2 font-medium text-ink">
                      {severityLabel(lastSeverity)}
                      {lastDiffScore !== null ? (
                        <span className="font-normal text-ink-soft">
                          {" "}
                          · 差分 {lastDiffScore.toFixed(4)}
                        </span>
                      ) : null}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {tickError && (
              <p className="mt-2 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
                {tickError}
              </p>
            )}
          </div>

          <CompareImageGrid
            probeUrl={currImageUrl ?? prevImageUrl}
            curr={{ title: "今回画像", imageNo: currImageNo, url: currImageUrl }}
            prev={{ title: "前回画像", imageNo: prevImageNo, url: prevImageUrl }}
          />

        </section>
      )}

      {activeTab === "history" && (
        <section className="mt-5 rounded-lg border border-line bg-white p-5">
          {historyViewMode && restoredSession && (
            <HistoryViewBanner session={restoredSession} />
          )}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                    <History className="h-4 w-4 text-signal" strokeWidth={1.75} />
                    アクティブ履歴
                  </h2>
                  <fieldset className="flex flex-wrap items-center gap-3 text-sm text-ink">
                    <legend className="sr-only">履歴の表示範囲</legend>
                    {(
                      [
                        [HISTORY_ALL, "すべて"],
                        [HISTORY_EVENTS_ONLY, "イベントのみ"],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value} className="inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="radio"
                          name="history-filter"
                          value={value}
                          checked={historyFilter === value}
                          onChange={() => setHistoryFilter(value)}
                          className="accent-signal"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </fieldset>
                </div>
                <MiniHelpButton onClick={() => setTabHelpModalOpen("history")} />
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                {historyFilter === HISTORY_ALL
                  ? "変化イベントに加え、処理は実行したがイベントにしなかったログも表示します。"
                  : "監視で検出した変化イベントのみを表示します。"}
                {displayedEvents.length > 0 ? `（${displayedEvents.length}件）` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {resolveHistoryFilesButtonVisible({
                monitoring,
                isPaused: !monitoring && monitoringStartedAt !== null,
              }) && (
                <button
                  type="button"
                  onClick={() => void handleOpenHistoryFiles()}
                  disabled={historyFilesLoading}
                  className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
                >
                  履歴フォルダーを見る
                </button>
              )}
              <button
                type="button"
                onClick={() => void loadEvents()}
                className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:border-signal/50"
              >
                更新
              </button>
            </div>
          </div>
          {historyFilesError && (
            <p className="mt-4 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
              {historyFilesError}
            </p>
          )}
          {eventsLoading && <p className="mt-6 text-sm text-ink-soft">読み込み中...</p>}
          {!eventsLoading && displayedEvents.length === 0 && (
            <p className="mt-6 text-sm text-ink-soft">
              {historyFilter === HISTORY_ALL
                ? "まだ処理ログはありません。"
                : "まだイベントはありません。"}
            </p>
          )}
          {!eventsLoading && displayedEvents.length > 0 && (
            <ul className="mt-5 divide-y divide-line">
              {displayedEvents.map((event) => (
                <li key={event.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                    <span>{formatTimestamp(event.created_at)}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-white ${severityColor(
                        event.severity
                      )}`}
                    >
                      {severityLabel(event.severity)}
                    </span>
                    {event.diff_score !== null && (
                      <span>差分 {Number(event.diff_score).toFixed(4)}</span>
                    )}
                    {event.analysis_tool && <span>{event.analysis_tool}</span>}
                    {event.prev_capture_no != null && event.curr_capture_no != null && (
                      <span className="inline-flex items-center gap-1">
                        <span className="font-en">
                          #{event.prev_capture_no}→#{event.curr_capture_no}
                        </span>
                        {event.prev_capture_id && event.curr_capture_id ? (
                          <button
                            type="button"
                            onClick={() => void openEventCompare(event)}
                            className="inline-flex rounded p-0.5 text-signal transition hover:bg-signal/10 hover:text-ink"
                            aria-label={`#${event.prev_capture_no}と#${event.curr_capture_no}の画像を表示`}
                            title="比較画像を表示"
                          >
                            <Images className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </button>
                        ) : null}
                      </span>
                    )}
                    {event.email_queued && <span>通知キューあり</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {event.ai_summary ?? "AI要約はありません。"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {activeTab === "images" && (
        <section className="mt-5 rounded-lg border border-line bg-white p-5">
          {historyViewMode && restoredSession && (
            <HistoryViewBanner session={restoredSession} />
          )}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                    <ImageIcon className="h-4 w-4 text-signal" strokeWidth={1.75} />
                    画像表示
                  </h2>
                  <fieldset className="flex flex-wrap items-center gap-3 text-sm text-ink">
                    <legend className="sr-only">処理状態で絞り込み</legend>
                    {(
                      [
                        [PROCESSED_ALL, "すべて"],
                        [PROCESSED_UNPROCESSED, "未処理のみ"],
                        [PROCESSED_DONE, "処理済のみ"],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value} className="inline-flex cursor-pointer items-center gap-1.5">
                        <input
                          type="radio"
                          name="processed-filter"
                          value={value}
                          checked={processedFilter === value}
                          onChange={() => setProcessedFilter(value)}
                          className="accent-signal"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </fieldset>
                </div>
                <MiniHelpButton onClick={() => setTabHelpModalOpen("images")} />
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                自動撮影で保存された画像を表示します。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadImages()}
              className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:border-signal/50"
            >
              更新
            </button>
          </div>

          {imagesError && (
            <p className="mt-4 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
              {imagesError}
            </p>
          )}
          {imagesLoading && <p className="mt-6 text-sm text-ink-soft">読み込み中...</p>}
          {!imagesLoading && images.length === 0 && (
            <p className="mt-6 text-sm text-ink-soft">表示できる画像はありません。</p>
          )}
          {!imagesLoading && images.length > 0 && (
            <ul className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {images.map((image) => (
                <li key={image.id}>
                  <button
                    type="button"
                    disabled={!image.signedUrl}
                    onClick={() => setImagePreview(image)}
                    className="w-full overflow-hidden rounded-md border border-line bg-white text-left transition hover:border-signal/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={
                      image.imageNo != null
                        ? `画像 #${image.imageNo} を拡大表示`
                        : "画像を拡大表示"
                    }
                  >
                    <NaturalAspectImage
                      src={image.signedUrl}
                      className="bg-line"
                      maxHeightClassName="max-h-40"
                    />
                    <div className="p-1.5 text-[10px] text-ink-soft">
                      <p>{formatTimestamp(image.created_at)}</p>
                      <p>
                        {image.imageNo != null ? (
                          <span className="font-en">#{image.imageNo}</span>
                        ) : null}
                        {image.imageNo != null ? " " : ""}
                        {image.processed_at ? "処理済み" : "未処理"}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {stopModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stop-modal-title"
          onClick={() => setStopModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-line bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="stop-modal-title" className="text-base font-semibold text-ink">
              停止する種類を選択してください
            </h2>
            <div className="mt-4 space-y-3">
              {(
                [
                  ["pause", "一時停止する（再開は可能）"],
                  [
                    "save_and_stop",
                    "アクティブ履歴・画像を「履歴フォルダー」に保存して「終了」する（再開は出来ません）",
                  ],
                  [
                    "stop_only",
                    "「終了」のみ（アクティブ履歴・画像を保存しない。再開は出来ません。）",
                  ],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-start gap-2 text-sm text-ink"
                >
                  <input
                    type="radio"
                    name="stop-choice"
                    value={value}
                    checked={stopChoice === value}
                    onChange={() => setStopChoice(value)}
                    className="mt-0.5 accent-signal"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStopModalOpen(false)}
                className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-signal/50"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmStop()}
                className="rounded-md bg-alert px-4 py-2 text-sm font-medium text-white transition hover:bg-alert/90"
              >
                実行
              </button>
            </div>
          </div>
        </div>
      )}

      {historyListModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-list-modal-title"
          onClick={() => setHistoryListModalOpen(false)}
        >
          <div
            className="flex max-h-[min(80vh,640px)] w-full max-w-lg flex-col rounded-lg border border-line bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3">
              <h2 id="history-list-modal-title" className="text-base font-semibold text-ink">
                履歴フォルダー
              </h2>
              <button
                type="button"
                onClick={() => setHistoryListModalOpen(false)}
                className="text-sm text-ink-soft hover:text-ink"
              >
                閉じる
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">
              {savedSessions.length === 0 && (
                <p className="py-4 text-sm text-ink-soft">保存された履歴フォルダーはありません。</p>
              )}
              {savedSessions.map((session) => {
                const isRestoringThis = restoringSessionId === session.id;
                const isBusy = restoringSessionId !== null;
                return (
                  <div
                    key={session.id}
                    className="flex items-center gap-1 border-b border-line/70 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => void handleSelectHistorySession(session)}
                      disabled={isBusy}
                      className="flex-1 py-3 text-left hover:bg-paper/80 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <p className="flex items-center gap-2 text-sm font-medium text-ink">
                        {formatSessionRangeLabel(session)}
                        {isRestoringThis && (
                          <span className="inline-flex items-center gap-1 text-xs font-normal text-signal">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                            処理中...
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ink-soft">
                        ログ{session.logCount}件 ・ 画像{session.imageCount}枚
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteHistorySession(session)}
                      disabled={isBusy}
                      className="shrink-0 rounded p-1.5 text-ink-soft transition hover:bg-alert/10 hover:text-alert disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`「${formatSessionRangeLabel(session)}」を削除`}
                      title="削除"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {templateModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-modal-title"
          onClick={() => setTemplateModalOpen(false)}
        >
          <div
            className="flex max-h-[min(85vh,720px)] w-full max-w-3xl flex-col rounded-lg border border-line bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3">
              <h2 id="template-modal-title" className="text-base font-semibold text-ink">
                システムテンプレート
              </h2>
              <button
                type="button"
                onClick={() => setTemplateModalOpen(false)}
                className="text-sm text-ink-soft hover:text-ink"
              >
                閉じる
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-1">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className="w-full border-b border-line/70 py-2 text-left last:border-b-0 hover:bg-paper/80"
                >
                  <p className="text-sm font-medium text-ink">{template.title}</p>
                  <p className="mt-0.5 text-xs leading-snug text-ink-soft">{template.summary}</p>
                </button>
              ))}
              {templates.length === 0 && (
                <p className="py-3 text-sm text-ink-soft">テンプレートがありません。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {meaningModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="meaning-modal-title"
          onClick={() => setMeaningModalOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-line bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
              <h2 id="meaning-modal-title" className="text-base font-semibold text-ink">
                監視条件を設定する意味
              </h2>
              <button
                type="button"
                onClick={() => setMeaningModalOpen(false)}
                className="text-sm text-ink-soft hover:text-ink"
              >
                閉じる
              </button>
            </div>
            <div className="space-y-4 px-5 py-4 text-sm leading-relaxed text-ink">
              <p>
                AIが画像を解析するとき、判定の精度を高めるための事前情報を渡す設定です。
              </p>
              <p>次の順で情報を与えると、効果が期待できます。</p>
              <ol className="list-decimal space-y-2 pl-5 text-ink">
                <li>
                  <span className="font-medium">監視ポイント</span>
                  <span className="text-ink-soft">（何を判定するか）</span>
                </li>
                <li>
                  <span className="font-medium">除外／無視してよいもの</span>
                </li>
                <li>
                  <span className="font-medium">画像全体の一文説明</span>
                </li>
                <li>
                  <span className="font-medium">通知したい変化の言い方</span>
                  <span className="text-ink-soft">（要約の質を高めるため）</span>
                </li>
              </ol>
            </div>
          </div>
        </div>
      )}


      {tabHelpModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tab-help-modal-title"
          onClick={() => setTabHelpModalOpen(null)}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-line bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
              <h2 id="tab-help-modal-title" className="text-base font-semibold text-ink">
                {TAB_HELP_CONTENT[tabHelpModalOpen].title}
              </h2>
              <button
                type="button"
                onClick={() => setTabHelpModalOpen(null)}
                className="text-sm text-ink-soft hover:text-ink"
              >
                閉じる
              </button>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm leading-relaxed text-ink">
              {TAB_HELP_CONTENT[tabHelpModalOpen].body.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {imagePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="image-preview-modal-title"
          onClick={() => setImagePreview(null)}
        >
          <div
            className="flex max-h-[min(92vh,900px)] w-full max-w-4xl flex-col rounded-lg border border-line bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3">
              <h2 id="image-preview-modal-title" className="text-base font-semibold text-ink">
                画像プレビュー
                {imagePreview.imageNo != null ? (
                  <span className="ml-2 font-en text-sm font-medium text-ink-soft">
                    #{imagePreview.imageNo}
                  </span>
                ) : null}
              </h2>
              <button
                type="button"
                onClick={() => setImagePreview(null)}
                className="text-sm text-ink-soft hover:text-ink"
              >
                閉じる
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <NaturalAspectImage
                src={imagePreview.signedUrl}
                alt={
                  imagePreview.imageNo != null
                    ? `画像 #${imagePreview.imageNo}`
                    : "拡大画像"
                }
                maxHeightClassName="max-h-[75vh]"
              />
              <p className="mt-3 text-sm text-ink-soft">
                {formatTimestamp(imagePreview.created_at)}
                {" · "}
                {imagePreview.processed_at ? "処理済み" : "未処理"}
              </p>
            </div>
          </div>
        </div>
      )}

      {eventCompareModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-compare-modal-title"
          onClick={() => setEventCompareModal(null)}
        >
          <div
            className="flex max-h-[min(90vh,840px)] w-full max-w-4xl flex-col rounded-lg border border-line bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-3">
              <h2 id="event-compare-modal-title" className="text-base font-semibold text-ink">
                比較画像
                {eventCompareModal.prevNo != null && eventCompareModal.currNo != null ? (
                  <span className="ml-2 font-en text-sm font-medium text-ink-soft">
                    #{eventCompareModal.prevNo}→#{eventCompareModal.currNo}
                  </span>
                ) : null}
              </h2>
              <button
                type="button"
                onClick={() => setEventCompareModal(null)}
                className="text-sm text-ink-soft hover:text-ink"
              >
                閉じる
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {eventCompareModal.loading && (
                <p className="text-sm text-ink-soft">画像を読み込み中...</p>
              )}
              {eventCompareModal.error && (
                <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
                  {eventCompareModal.error}
                </p>
              )}
              {!eventCompareModal.loading && !eventCompareModal.error && (
                <CompareImageGrid
                  probeUrl={eventCompareModal.currUrl ?? eventCompareModal.prevUrl}
                  curr={{
                    title: "今回画像",
                    imageNo: eventCompareModal.currNo,
                    url: eventCompareModal.currUrl,
                  }}
                  prev={{
                    title: "前回画像",
                    imageNo: eventCompareModal.prevNo,
                    url: eventCompareModal.prevUrl,
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {promptModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-modal-title"
          onClick={() => setPromptModalOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-line bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="prompt-modal-title" className="text-base font-semibold text-ink">
                AIへの命令プロンプト
              </h2>
              <button
                type="button"
                onClick={() => setPromptModalOpen(false)}
                className="text-sm text-ink-soft hover:text-ink"
              >
                閉じる
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-soft">
              画像解析AI（Gemini）に渡している実際の文章です。設定タブの内容から組み立てています。
            </p>
            <pre className="mt-4 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-paper p-3 font-sans text-sm leading-relaxed text-ink">
              {currentPromptText}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function MonitoringPulse() {
  return (
    <div
      className="relative flex h-11 w-11 shrink-0 items-center justify-center"
      aria-hidden
    >
      <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-signal border-r-signal/40 animate-spin [animation-duration:1.1s]" />
      <div className="absolute inset-1.5 rounded-full border-2 border-transparent border-b-[#00c2b8] border-l-signal/50 animate-spin [animation-duration:0.8s] [animation-direction:reverse]" />
      <div className="h-3.5 w-3.5 rounded-full bg-signal shadow-[0_0_10px_rgba(14,124,134,0.55)] animate-pulse" />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-2 text-xs font-medium transition sm:text-sm ${
        active ? "bg-signal text-white" : "text-ink-soft hover:bg-signal-soft hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function LampGroup({ severity }: { severity: MonitorSeverity | null }) {
  return (
    <div className="flex items-center gap-4" aria-label="監視ランプ">
      <Lamp
        color="bg-emerald-500"
        glow="shadow-[0_0_22px_rgba(16,185,129,0.85)] ring-emerald-300"
        active={severity === "skip"}
        label="緑"
      />
      <Lamp
        color="bg-yellow-400"
        glow="shadow-[0_0_22px_rgba(250,204,21,0.9)] ring-yellow-200"
        active={severity === "minor"}
        label="黄"
      />
      <Lamp
        color="bg-red-600"
        glow="shadow-[0_0_22px_rgba(220,38,38,0.9)] ring-red-300"
        active={severity === "notify"}
        label="赤"
      />
    </div>
  );
}

function Lamp({
  color,
  glow,
  active,
  label,
}: {
  color: string;
  glow: string;
  active: boolean;
  label: string;
}) {
  return (
    <span
      role="img"
      aria-label={`${label}${active ? "（点灯中）" : ""}`}
      title={active ? `${label}（点灯中）` : label}
      className={`inline-block h-16 w-16 rounded-full ${color} ${
        active
          ? `opacity-100 ring-4 ${glow} animate-pulse`
          : "opacity-20 grayscale"
      }`}
    />
  );
}

function NaturalAspectImage({
  src,
  alt = "",
  className = "",
  maxHeightClassName = "max-h-[70vh]",
}: {
  src: string | null;
  alt?: string;
  className?: string;
  maxHeightClassName?: string;
}) {
  if (!src) {
    return (
      <div className={`flex min-h-32 items-center justify-center text-sm text-ink-soft ${className}`}>
        画像待機中
      </div>
    );
  }

  return (
    <div className={`bg-line ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={`mx-auto h-auto w-full object-contain ${maxHeightClassName}`}
      />
    </div>
  );
}

/** 「履歴フォルダー」から復元して閲覧中であることを知らせる案内バナー。 */
function HistoryViewBanner({ session }: { session: MonitorSession }) {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert">
      <History className="h-4 w-4 shrink-0" strokeWidth={1.75} />
      <span>
        過去の履歴ログデータを表示しています：{formatSessionRangeLabel(session)}
      </span>
    </div>
  );
}

function ImagePanel({
  title,
  imageNo,
  url,
  maxHeightClassName,
}: {
  title: string;
  imageNo: number | null;
  url: string | null;
  maxHeightClassName?: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="border-b border-line px-3 py-2 text-sm font-medium text-ink">
        {title}
        {imageNo != null ? (
          <span className="ml-2 font-en text-ink-soft">#{imageNo}</span>
        ) : null}
      </div>
      <NaturalAspectImage
        src={url}
        alt={title}
        maxHeightClassName={maxHeightClassName}
      />
    </div>
  );
}

type ComparePanel = {
  title: string;
  imageNo: number | null;
  url: string | null;
};

/** Portrait → 2-up grid; landscape → stacked rows (current layout). */
function CompareImageGrid({
  probeUrl,
  curr,
  prev,
}: {
  probeUrl: string | null;
  curr: ComparePanel;
  prev: ComparePanel;
}) {
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    setIsPortrait(false);
    if (!probeUrl) return;

    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (cancelled) return;
      setIsPortrait(img.naturalHeight > img.naturalWidth);
    };
    img.onerror = () => {
      if (!cancelled) setIsPortrait(false);
    };
    img.src = probeUrl;

    return () => {
      cancelled = true;
    };
  }, [probeUrl]);

  const maxHeightClassName = isPortrait ? "max-h-[55vh]" : "max-h-[70vh]";
  const panels = [curr, prev];

  return (
    <div className={`grid gap-4 ${isPortrait ? "grid-cols-2" : "grid-cols-1"}`}>
      {panels.map((panel) => (
        <ImagePanel
          key={panel.title}
          title={panel.title}
          imageNo={panel.imageNo}
          url={panel.url}
          maxHeightClassName={maxHeightClassName}
        />
      ))}
    </div>
  );
}
