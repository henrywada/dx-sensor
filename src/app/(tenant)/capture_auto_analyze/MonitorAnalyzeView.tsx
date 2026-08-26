"use client";

import Link from "next/link";
import { Bell, CircleHelp, FileText, History, ImageIcon, ListChecks, Play, Settings, Square, Wand2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildMonitorPrompt } from "@/lib/monitor/buildMonitorPrompt";
import type {
  MonitorSeverity,
  MonitorUserSettings,
  SystemMonitorTemplate,
} from "@/lib/monitor/types";

const SLOT_COUNT = 10;
const TICK_INTERVAL_MS = 5_000;
const IMAGE_PAGE_SIZE = 80;
const ALL_IMAGES = "all";
const SESSION_IMAGES = "session";

type TabId = "settings" | "status" | "history" | "images";
type ImageFilter = typeof ALL_IMAGES | typeof SESSION_IMAGES;

type MonitorAnalyzeViewProps = {
  tenantId: string;
  userId: string;
};

type MonitorEvent = {
  id: string;
  severity: Exclude<MonitorSeverity, "skip">;
  diff_score: number | null;
  ai_summary: string | null;
  email_queued: boolean;
  created_at: string;
};

type MonitorTickResponse = {
  status: "waiting" | "baseline" | "processed";
  severity: MonitorSeverity | null;
  diffScore: number | null;
  prevCaptureId: string | null;
  currCaptureId: string | null;
  prevSignedUrl: string | null;
  currSignedUrl: string | null;
  summary: string | null;
  eventId: string | null;
  message?: string;
};

type AutoCaptureRow = {
  id: string;
  storage_path: string;
  created_at: string;
  processed_at: string | null;
};

type CaptureImage = AutoCaptureRow & {
  signedUrl: string | null;
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
  });
}

function severityLabel(severity: MonitorSeverity | null): string {
  if (severity === "notify") return "通知対象";
  if (severity === "minor") return "軽微な変化";
  if (severity === "skip") return "変化なし";
  return "待機中";
}

function severityColor(severity: MonitorSeverity): string {
  if (severity === "notify") return "bg-red-600";
  if (severity === "minor") return "bg-yellow-400";
  return "bg-emerald-500";
}

export function MonitorAnalyzeView({ tenantId, userId }: MonitorAnalyzeViewProps) {
  const supabase = useMemo(() => createClient(), []);

  const [activeTab, setActiveTab] = useState<TabId>("settings");
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

  const [imageFilter, setImageFilter] = useState<ImageFilter>(ALL_IMAGES);
  const [images, setImages] = useState<CaptureImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imagesError, setImagesError] = useState<string | null>(null);

  const lastCurrCaptureIdRef = useRef<string | null>(null);
  const tickInFlightRef = useRef(false);
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

  const attachSignedUrls = useCallback(
    async (rows: AutoCaptureRow[]): Promise<CaptureImage[]> => {
      return Promise.all(
        rows.map(async (row) => {
          const { data } = await supabase.storage
            .from("auto-captures")
            .createSignedUrl(row.storage_path, 3600);
          return { ...row, signedUrl: data?.signedUrl ?? null };
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

    if (imageFilter === SESSION_IMAGES) {
      if (!monitoringStartedAt) {
        setImages([]);
        setImagesLoading(false);
        return;
      }
      query = query.not("processed_at", "is", null).gte("processed_at", monitoringStartedAt);
    }

    const { data, error } = await query;
    if (error) {
      setImagesError(error.message);
      setImages([]);
      setImagesLoading(false);
      return;
    }

    const withUrls = await attachSignedUrls((data ?? []) as AutoCaptureRow[]);
    setImages(withUrls);
    setImagesLoading(false);
  }, [attachSignedUrls, imageFilter, monitoringStartedAt, supabase, tenantId, userId]);

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
    void loadEvents();

    return () => {
      cancelled = true;
    };
  }, [loadEvents]);

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
      if (result.eventId || result.status === "processed" || result.status === "baseline") {
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

    const tick = () => void runTickRef.current();
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
    const startedAt = new Date().toISOString();
    setMonitoringStartedAt(startedAt);
    setMonitoring(true);
    setActiveTab("status");
    setLastSeverity(null);
    setLastDiffScore(null);
    setLastMessage("監視を開始しました。次の画像を確認しています。");
    setTickError(null);
    setPrevImageUrl(null);
    setCurrImageUrl(null);
    setPrevImageNo(null);
    setCurrImageNo(null);
    setMonitorCount(0);
    lastCurrCaptureIdRef.current = null;
  }

  function handleStopMonitoring() {
    setMonitoring(false);
    setLastMessage("監視を停止しました。");
  }

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
        アプリ内撮影で蓄積した画像を、画面を開いている間だけ5秒ごとに比較し、変化をAIで解析します。
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg border border-line bg-white p-1 sm:grid-cols-4">
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

      {activeTab === "settings" && (
        <section className="mt-5 rounded-lg border border-line bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                  <Settings className="h-4 w-4 text-signal" strokeWidth={1.75} />
                  監視条件の設定
                </h2>
                <button
                  type="button"
                  onClick={() => setMeaningModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:border-signal/50 hover:text-ink"
                >
                  <CircleHelp className="h-3.5 w-3.5" strokeWidth={1.75} />
                  監視条件を設定する意味
                </button>
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

              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={monitoring ? handleStopMonitoring : handleStartMonitoring}
                  className={`inline-flex min-w-44 items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-medium text-white transition ${
                    monitoring ? "bg-alert hover:bg-alert/90" : "bg-signal hover:bg-signal/90"
                  }`}
                >
                  {monitoring ? (
                    <>
                      <Square className="h-4 w-4" strokeWidth={1.75} />
                      監視を停止
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" strokeWidth={1.75} />
                      監視の開始
                    </>
                  )}
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
              <button
                type="button"
                onClick={() => setPromptModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:border-signal/50"
              >
                <FileText className="h-4 w-4 text-signal" strokeWidth={1.75} />
                命令を表示
              </button>
              <button
                type="button"
                onClick={monitoring ? handleStopMonitoring : handleStartMonitoring}
                className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition ${
                  monitoring ? "bg-alert hover:bg-alert/90" : "bg-signal hover:bg-signal/90"
                }`}
              >
                {monitoring ? (
                  <>
                    <Square className="h-4 w-4" strokeWidth={1.75} />
                    停止
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" strokeWidth={1.75} />
                    開始
                  </>
                )}
              </button>
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

          <div className="grid gap-4 md:grid-cols-2">
            <ImagePanel title="前回画像" imageNo={prevImageNo} url={prevImageUrl} />
            <ImagePanel title="今回画像" imageNo={currImageNo} url={currImageUrl} />
          </div>

          <div className="rounded-lg border border-line bg-white p-5">
            <div className="flex justify-end">
              <div className="text-right">
                <p className="text-xs font-medium text-ink-soft">ステータス</p>
                <p className="mt-0.5 text-sm font-medium text-ink">
                  {severityLabel(lastSeverity)}
                  {lastDiffScore !== null ? (
                    <span className="font-normal text-ink-soft">
                      {" "}
                      · 差分 {lastDiffScore.toFixed(4)}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="mt-4 flex justify-center">
              <div className="grid grid-cols-[auto_auto] items-center gap-6">
                <LampGroup severity={lastSeverity} />
                <div className="min-w-0">
                  <ul className="space-y-1.5 text-left text-xs leading-snug text-ink-soft">
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
                  <p className="mt-3 text-left text-sm leading-relaxed text-ink">{lastMessage}</p>
                </div>
              </div>
            </div>

            {tickError && (
              <p className="mt-3 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
                {tickError}
              </p>
            )}
          </div>

        </section>
      )}

      {activeTab === "history" && (
        <section className="mt-5 rounded-lg border border-line bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <History className="h-4 w-4 text-signal" strokeWidth={1.75} />
                イベント履歴
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                監視で検出した変化イベントをすべて表示します。
                {events.length > 0 ? `（${events.length}件）` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadEvents()}
              className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:border-signal/50"
            >
              更新
            </button>
          </div>
          {eventsLoading && <p className="mt-6 text-sm text-ink-soft">読み込み中...</p>}
          {!eventsLoading && events.length === 0 && (
            <p className="mt-6 text-sm text-ink-soft">まだイベントはありません。</p>
          )}
          {!eventsLoading && events.length > 0 && (
            <ul className="mt-5 divide-y divide-line">
              {events.map((event) => (
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
                <ImageIcon className="h-4 w-4 text-signal" strokeWidth={1.75} />
                画像表示
              </h2>
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

          <div className="mt-4 flex flex-wrap gap-2">
            <FilterButton
              active={imageFilter === ALL_IMAGES}
              onClick={() => setImageFilter(ALL_IMAGES)}
            >
              全部
            </FilterButton>
            <FilterButton
              active={imageFilter === SESSION_IMAGES}
              onClick={() => setImageFilter(SESSION_IMAGES)}
            >
              今回の監視分
            </FilterButton>
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
                <li key={image.id} className="overflow-hidden rounded-md border border-line bg-white">
                  <div className="aspect-[3/4] bg-line">
                    {image.signedUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={image.signedUrl}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-ink-soft">
                        画像なし
                      </div>
                    )}
                  </div>
                  <div className="p-1.5 text-[10px] text-ink-soft">
                    <p>{formatTimestamp(image.created_at)}</p>
                    <p>{image.processed_at ? "処理済み" : "未処理"}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
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

function FilterButton({
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
      className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-signal text-white"
          : "border border-line bg-white text-ink hover:border-signal/50"
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

function ImagePanel({
  title,
  imageNo,
  url,
}: {
  title: string;
  imageNo: number | null;
  url: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="border-b border-line px-3 py-2 text-sm font-medium text-ink">
        {title}
        {imageNo != null ? (
          <span className="ml-2 font-en text-ink-soft">#{imageNo}</span>
        ) : null}
      </div>
      <div className="aspect-[3/4] max-h-[70vh] bg-line">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={title} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-soft">
            画像待機中
          </div>
        )}
      </div>
    </div>
  );
}
