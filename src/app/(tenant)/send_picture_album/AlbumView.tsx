"use client";

import Link from "next/link";
import { Images, LayoutGrid, List } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { picturePriorityLabel, type PicturePriority } from "@/lib/picture-sends/priority";

const PAGE_SIZE = 100;
const ALL_SUBJECTS = "";
const VIEW_MODE_STORAGE_KEY = "dx-sensor.album.view-mode";

type ViewMode = "thumbnail" | "list";

type PictureSendRow = {
  id: string;
  subject_text: string;
  body_text: string;
  priority: PicturePriority;
  storage_path: string;
  created_at: string;
};

type AlbumItem = PictureSendRow & {
  thumbnailUrl: string | null;
};

type AlbumViewProps = {
  userId: string;
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readStoredViewMode(): ViewMode {
  if (typeof window === "undefined") return "thumbnail";
  return window.localStorage.getItem(VIEW_MODE_STORAGE_KEY) === "list"
    ? "list"
    : "thumbnail";
}

function isHighPriority(priority: unknown): boolean {
  return priority === "high";
}

function HighPriorityBadge({ size = "md" }: { size?: "sm" | "md" }) {
  const sizeClass =
    size === "sm" ? "px-1 py-px text-[10px]" : "px-1.5 py-0.5 text-xs";
  return (
    <span
      className={`inline-flex items-center rounded font-bold text-white bg-alert ${sizeClass}`}
    >
      高
    </span>
  );
}

export function AlbumView({ userId }: AlbumViewProps) {
  const supabase = createClient();

  const [items, setItems] = useState<AlbumItem[]>([]);
  const [subjectFilter, setSubjectFilter] = useState(ALL_SUBJECTS);
  const [highOnly, setHighOnly] = useState(false);
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("thumbnail");
  const [viewModeReady, setViewModeReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bodyDraft, setBodyDraft] = useState("");
  const [savingBody, setSavingBody] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailMessage, setDetailMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );

  const attachSignedUrls = useCallback(
    async (rows: PictureSendRow[]): Promise<AlbumItem[]> => {
      return Promise.all(
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
    },
    [supabase]
  );

  const loadSubjectOptions = useCallback(async () => {
    const { data, error: qError } = await supabase
      .from("picture_sends")
      .select("subject_text")
      .eq("user_id", userId)
      .order("subject_text");

    if (qError) {
      console.error("load subject options failed", qError);
      return;
    }

    const unique = [
      ...new Set((data ?? []).map((r) => r.subject_text as string).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, "ja"));
    setSubjectOptions(unique);
  }, [supabase, userId]);

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }

      let query = supabase
        .from("picture_sends")
        .select("id, subject_text, body_text, priority, storage_path, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (subjectFilter !== ALL_SUBJECTS) {
        query = query.eq("subject_text", subjectFilter);
      }
      if (highOnly) {
        query = query.eq("priority", "high");
      }

      const { data, error: qError } = await query;

      if (qError) {
        console.error("load album failed", qError);
        setError(qError.message);
        if (!append) setItems([]);
        setHasMore(false);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      const rows = (data ?? []) as PictureSendRow[];
      const withUrls = await attachSignedUrls(rows);

      setItems((prev) => (append ? [...prev, ...withUrls] : withUrls));
      setHasMore(rows.length === PAGE_SIZE);
      setLoading(false);
      setLoadingMore(false);
    },
    [attachSignedUrls, highOnly, subjectFilter, supabase, userId]
  );

  useEffect(() => {
    setViewMode(readStoredViewMode());
    setViewModeReady(true);
  }, []);

  useEffect(() => {
    if (!viewModeReady) return;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode, viewModeReady]);

  useEffect(() => {
    void loadSubjectOptions();
  }, [loadSubjectOptions]);

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  useEffect(() => {
    if (selected) {
      setBodyDraft(selected.body_text);
      setDetailError(null);
      setDetailMessage(null);
    }
  }, [selected]);

  function openDetail(item: AlbumItem) {
    setSelectedId(item.id);
    setBodyDraft(item.body_text);
    setDetailError(null);
    setDetailMessage(null);
  }

  function closeDetail() {
    setSelectedId(null);
    setDetailError(null);
    setDetailMessage(null);
  }

  async function handleSaveBody() {
    if (!selected) return;
    setSavingBody(true);
    setDetailError(null);
    setDetailMessage(null);

    const { error: updateError } = await supabase
      .from("picture_sends")
      .update({ body_text: bodyDraft })
      .eq("id", selected.id)
      .eq("user_id", userId);

    setSavingBody(false);

    if (updateError) {
      setDetailError(updateError.message);
      return;
    }

    setItems((prev) =>
      prev.map((item) =>
        item.id === selected.id ? { ...item, body_text: bodyDraft } : item
      )
    );
    setDetailMessage("本文を保存しました。");
  }

  async function handleDelete() {
    if (!selected) return;
    const ok = window.confirm("この写真を削除しますか？元に戻せません。");
    if (!ok) return;

    setDeleting(true);
    setDetailError(null);
    setDetailMessage(null);

    const { error: storageError } = await supabase.storage
      .from("picture-sends")
      .remove([selected.storage_path]);

    if (storageError) {
      console.error("storage delete failed", storageError);
      setDetailError(`画像の削除に失敗しました: ${storageError.message}`);
      setDeleting(false);
      return;
    }

    const { error: deleteError } = await supabase
      .from("picture_sends")
      .delete()
      .eq("id", selected.id)
      .eq("user_id", userId);

    setDeleting(false);

    if (deleteError) {
      setDetailError(deleteError.message);
      return;
    }

    setItems((prev) => prev.filter((item) => item.id !== selected.id));
    closeDetail();
    void loadSubjectOptions();
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Images className="h-5 w-5 text-signal" strokeWidth={1.75} />
          <h1 className="text-lg font-semibold text-ink">写真フォルダー</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/send_picture"
            className="font-medium text-signal transition-colors hover:text-ink"
          >
            写真を撮る
          </Link>
          <Link
            href="/"
            className="font-medium text-signal transition-colors hover:text-ink"
          >
            ←戻る
          </Link>
        </div>
      </div>

      <p className="mt-2 text-sm text-ink-soft">
        送信した写真を一覧表示します。タップで詳細・本文編集・削除ができます。
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="flex flex-col gap-1.5 text-sm sm:flex-row sm:items-center sm:gap-3">
            <span className="font-medium text-ink">件名</span>
            <select
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal sm:max-w-xs"
            >
              <option value={ALL_SUBJECTS}>すべて</option>
              {subjectOptions.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </select>
          </label>

          <label className="inline-flex cursor-pointer items-center gap-1.5 self-start text-sm text-ink">
            <input
              type="checkbox"
              checked={highOnly}
              onChange={(e) => setHighOnly(e.target.checked)}
              className="accent-alert"
            />
            高のみ表示
          </label>
        </div>

        <div
          className="inline-flex self-start rounded-md border border-line bg-white p-0.5"
          role="radiogroup"
          aria-label="表示切替"
        >
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === "thumbnail"}
            onClick={() => setViewMode("thumbnail")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition sm:text-sm ${
              viewMode === "thumbnail"
                ? "bg-signal text-white"
                : "text-ink-soft hover:bg-signal-soft hover:text-ink"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            サムネイル
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={viewMode === "list"}
            onClick={() => setViewMode("list")}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition sm:text-sm ${
              viewMode === "list"
                ? "bg-signal text-white"
                : "text-ink-soft hover:bg-signal-soft hover:text-ink"
            }`}
          >
            <List className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
            リスト
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{error}</p>
      )}

      {loading && <p className="mt-8 text-sm text-ink-soft">読み込み中...</p>}

      {!loading && items.length === 0 && (
        <p className="mt-8 text-sm text-ink-soft">
          {highOnly ? "優先度「高」の写真はありません。" : "まだ写真がありません。"}
        </p>
      )}

      {!loading && items.length > 0 && viewMode === "thumbnail" && (
        <ul className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => openDetail(item)}
                className="group flex w-full flex-col overflow-hidden rounded-md border border-line bg-white text-left transition hover:border-signal/50"
              >
                <div className="relative aspect-square w-full overflow-hidden bg-line">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-soft">
                      画像なし
                    </div>
                  )}
                  {isHighPriority(item.priority) && (
                    <span className="absolute left-1 top-1">
                      <HighPriorityBadge size="sm" />
                    </span>
                  )}
                </div>
                <div className="space-y-0.5 p-1.5 sm:p-2">
                  <p className="truncate text-[11px] font-medium text-ink sm:text-xs">
                    {item.subject_text}
                  </p>
                  {!isHighPriority(item.priority) && (
                    <p className="truncate text-[10px] text-ink-soft">
                      優先度：{picturePriorityLabel(item.priority)}
                    </p>
                  )}
                  <p className="truncate text-[10px] text-ink-soft">
                    {formatTimestamp(item.created_at)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && items.length > 0 && viewMode === "list" && (
        <ul className="mt-6 divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => openDetail(item)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-signal-soft/40"
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded bg-line">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-soft">
                      画像なし
                    </div>
                  )}
                  {isHighPriority(item.priority) && (
                    <span className="absolute left-0.5 top-0.5">
                      <HighPriorityBadge size="sm" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
                    <span className="truncate">{item.subject_text}</span>
                    {isHighPriority(item.priority) && <HighPriorityBadge />}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">
                    {!isHighPriority(item.priority) && (
                      <>優先度：{picturePriorityLabel(item.priority)}　</>
                    )}
                    {formatTimestamp(item.created_at)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadPage(items.length, true)}
            className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
          >
            {loadingMore ? "読み込み中..." : "もっと見る"}
          </button>
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="album-detail-title"
          onClick={closeDetail}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                id="album-detail-title"
                className="flex min-w-0 items-center gap-2 text-base font-semibold text-ink"
              >
                <span className="truncate">{selected.subject_text}</span>
                {isHighPriority(selected.priority) && <HighPriorityBadge />}
              </h2>
              <button
                type="button"
                onClick={closeDetail}
                className="text-sm text-ink-soft hover:text-ink"
              >
                閉じる
              </button>
            </div>

            <p className="mt-1 text-xs text-ink-soft">
              {!isHighPriority(selected.priority) && (
                <>優先度：{picturePriorityLabel(selected.priority)}　</>
              )}
              {formatTimestamp(selected.created_at)}
            </p>

            <div className="mt-3 overflow-hidden rounded-md border border-line bg-black">
              {selected.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selected.thumbnailUrl}
                  alt={selected.subject_text}
                  className="max-h-[50vh] w-full object-contain"
                />
              ) : (
                <div className="flex h-40 items-center justify-center text-sm text-white/80">
                  画像を表示できません
                </div>
              )}
            </div>

            <label className="mt-4 block space-y-1.5">
              <span className="text-sm font-medium text-ink">本文</span>
              <textarea
                value={bodyDraft}
                onChange={(e) => setBodyDraft(e.target.value)}
                rows={4}
                disabled={savingBody || deleting}
                className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-50"
              />
            </label>

            {detailMessage && (
              <p className="mt-2 rounded-md bg-signal/10 px-3 py-2 text-sm text-signal">
                {detailMessage}
              </p>
            )}
            {detailError && (
              <p className="mt-2 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
                {detailError}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSaveBody()}
                disabled={savingBody || deleting || bodyDraft === selected.body_text}
                className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingBody ? "保存中..." : "本文を保存"}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={savingBody || deleting}
                className="rounded-md bg-alert px-4 py-2 text-sm font-medium text-white transition hover:bg-alert/90 disabled:opacity-50"
              >
                {deleting ? "削除中..." : "削除"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
