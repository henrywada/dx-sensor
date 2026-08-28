"use client";

import Link from "next/link";
import {
  BriefcaseBusiness,
  FileText,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  StickyNote,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  INVOICE_HEADER_KEYS,
  INVOICE_FIELD_LABELS,
  type InvoiceHeaderKey,
} from "@/lib/documents/types/invoice/plugin";
import type { LineItemDraft } from "@/lib/documents/pluginTypes";

const ALL_TAGS = "";

type ScopeFilter = "own" | "company" | "all";
type ViewMode = "thumbnail" | "list";

type InvoiceListItem = {
  id: string;
  documentType: string;
  ownerUserId: string;
  companyVisible: boolean;
  title: string;
  counterparty: string;
  contextDate: string | null;
  amountYen: number | string | null;
  notes: string;
  tags: string[];
  extracted: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  frontImageUrl: string | null;
};

type LineItemDetail = {
  id: string;
  lineNo: number;
  transactionDate: string | null;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: number | null;
  amount: number | null;
  taxRate: string;
};

type InvoiceDetail = Omit<InvoiceListItem, "frontImageUrl"> & {
  rawOcr: string;
  canMutate: boolean;
  images: {
    id: string;
    role: string;
    sortOrder: number;
    storagePath: string;
    url: string | null;
  }[];
  lineItems: LineItemDetail[];
};

type ListResponse = {
  documents?: InvoiceListItem[];
  hasMore?: boolean;
  nextOffset?: number | null;
  error?: string;
};

type DetailResponse = {
  document?: InvoiceDetail;
  error?: string;
};

type AnalyzeResponse = {
  extracted?: Record<string, string>;
  lineItems?: LineItemDetail[];
  warning?: "ocr_failed";
  error?: string;
};

interface InvoiceAlbumProps {
  documentType: "invoice";
  userId: string;
  initialOpenId: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return "日付なし";
  return new Date(`${value}T00:00:00+09:00`).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmountYen(value: number | string | null): string {
  if (value === null || value === "" || value === undefined) return "金額未設定";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "金額未設定";
  return `¥${num.toLocaleString("ja-JP")}`;
}

function parseTagsInput(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n、]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function hasNotes(notes: string): boolean {
  return notes.trim().length > 0;
}

function NotesIndicator({ className }: { className?: string }) {
  return (
    <StickyNote
      className={className ?? "h-3.5 w-3.5 shrink-0 text-signal"}
      strokeWidth={1.75}
      aria-label="メモあり"
    />
  );
}

function emptyHeader(): Record<InvoiceHeaderKey, string> {
  return Object.fromEntries(INVOICE_HEADER_KEYS.map((key) => [key, ""])) as Record<
    InvoiceHeaderKey,
    string
  >;
}

function normalizeHeader(value: Record<string, string>): Record<InvoiceHeaderKey, string> {
  const next = emptyHeader();
  for (const key of INVOICE_HEADER_KEYS) {
    next[key] = value[key] ?? "";
  }
  return next;
}

function lineItemDetailToDraft(item: LineItemDetail): LineItemDraft {
  return {
    line_no: item.lineNo,
    transaction_date: item.transactionDate,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unitPrice !== null ? String(item.unitPrice) : "",
    amount: item.amount !== null ? String(item.amount) : "",
    tax_rate: item.taxRate,
  };
}

function ownerLabel(item: Pick<InvoiceListItem, "ownerUserId">, userId: string) {
  return item.ownerUserId === userId ? "自分" : "会社共有";
}

export function InvoiceAlbum({ documentType, userId, initialOpenId }: InvoiceAlbumProps) {
  const [items, setItems] = useState<InvoiceListItem[]>([]);
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [tagFilter, setTagFilter] = useState(ALL_TAGS);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [searchText, setSearchText] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailMessage, setDetailMessage] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  const [headerDraft, setHeaderDraft] = useState<Record<InvoiceHeaderKey, string>>(emptyHeader);
  const [lineItemsDraft, setLineItemsDraft] = useState<LineItemDraft[]>([]);
  const [notesDraft, setNotesDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [contextDateDraft, setContextDateDraft] = useState("");
  const [companyVisibleDraft, setCompanyVisibleDraft] = useState(false);

  const tagOptions = useMemo(() => {
    return Array.from(new Set(items.flatMap((item) => item.tags))).sort((a, b) =>
      a.localeCompare(b, "ja")
    );
  }, [items]);

  const selectedSummary = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );

  const syncDraft = useCallback((doc: InvoiceDetail) => {
    setHeaderDraft(normalizeHeader(doc.extracted));
    setLineItemsDraft(doc.lineItems.map(lineItemDetailToDraft));
    setNotesDraft(doc.notes ?? "");
    setTagsDraft((doc.tags ?? []).join(", "));
    setContextDateDraft(doc.contextDate ?? "");
    setCompanyVisibleDraft(doc.companyVisible);
  }, []);

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }

      const params = new URLSearchParams({
        type: documentType,
        scope,
        offset: String(offset),
      });
      if (tagFilter !== ALL_TAGS) params.append("tag", tagFilter);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      if (amountMin) params.set("amount_min", amountMin);
      if (amountMax) params.set("amount_max", amountMax);
      if (appliedSearch) params.set("q", appliedSearch);

      try {
        const response = await fetch(`/api/documents?${params.toString()}`);
        const result = (await response.json().catch(() => ({}))) as ListResponse;
        if (!response.ok) {
          throw new Error(result.error ?? "文書一覧の取得に失敗しました。");
        }
        const documents = result.documents ?? [];
        setItems((current) => (append ? [...current, ...documents] : documents));
        setHasMore(Boolean(result.hasMore));
        setNextOffset(result.nextOffset ?? null);
        if (!append) setSelectedIds(new Set());
      } catch (err) {
        console.error("invoice list load failed", err);
        setError(err instanceof Error ? err.message : "文書一覧の取得に失敗しました。");
        if (!append) setItems([]);
        setHasMore(false);
        setNextOffset(null);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [appliedSearch, documentType, fromDate, scope, tagFilter, toDate, amountMin, amountMax]
  );

  const loadDetail = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDetailLoading(true);
      setDetail(null);
      setDetailError(null);
      setDetailMessage(null);

      try {
        const response = await fetch(`/api/documents/${id}`);
        const result = (await response.json().catch(() => ({}))) as DetailResponse;
        if (!response.ok || !result.document) {
          throw new Error(result.error ?? "文書の取得に失敗しました。");
        }
        setDetail(result.document);
        syncDraft(result.document);
      } catch (err) {
        console.error("invoice detail load failed", err);
        setDetailError(err instanceof Error ? err.message : "文書の取得に失敗しました。");
      } finally {
        setDetailLoading(false);
      }
    },
    [syncDraft]
  );

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  useEffect(() => {
    if (!initialOpenId) return;
    void loadDetail(initialOpenId);
  }, [initialOpenId, loadDetail]);

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setDetailMessage(null);
  }

  function applySearch() {
    setAppliedSearch(searchText.trim());
  }

  function toggleCheck(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (items.every((item) => selectedIds.has(item.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((item) => item.id)));
    }
  }

  async function handleExportCsv() {
    if (selectedIds.size === 0) {
      setExportError("請求書を選択してください。");
      return;
    }
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch("/api/documents/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "invoice",
          documentIds: Array.from(selectedIds),
        }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error ?? "CSVエクスポートに失敗しました。");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
      ].join("");
      a.href = url;
      a.download = `invoices_${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "CSVエクスポートに失敗しました。");
    } finally {
      setExporting(false);
    }
  }

  async function patchDetail(
    id: string,
    body: {
      companyVisible?: boolean;
      notes?: string;
      tags?: string[];
      contextDate?: string | null;
      extracted?: Record<string, string>;
      lineItems?: LineItemDraft[];
    },
    successMessage: string
  ) {
    const response = await fetch(`/api/documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as DetailResponse;
    if (!response.ok || !result.document) {
      throw new Error(result.error ?? "文書の更新に失敗しました。");
    }

    setDetail(result.document);
    syncDraft(result.document);
    setItems((current) =>
      current.map((item) =>
        item.id === result.document!.id
          ? {
              ...item,
              ownerUserId: result.document!.ownerUserId,
              companyVisible: result.document!.companyVisible,
              title: result.document!.title,
              counterparty: result.document!.counterparty,
              contextDate: result.document!.contextDate,
              amountYen: result.document!.amountYen,
              notes: result.document!.notes,
              tags: result.document!.tags,
              extracted: result.document!.extracted,
              updatedAt: result.document!.updatedAt,
            }
          : item
      )
    );
    setDetailMessage(successMessage);
  }

  async function handleSaveDetail() {
    if (!detail) return;
    const ok = window.confirm("編集内容を保存しますか？");
    if (!ok) return;

    setSaving(true);
    setDetailError(null);
    setDetailMessage(null);
    try {
      await patchDetail(
        detail.id,
        {
          companyVisible: companyVisibleDraft,
          notes: notesDraft,
          tags: parseTagsInput(tagsDraft),
          contextDate: contextDateDraft || null,
          extracted: headerDraft,
          lineItems: lineItemsDraft,
        },
        "文書を保存しました。"
      );
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "文書の更新に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!detail) return;
    const ok = window.confirm("この文書を削除しますか？元に戻せません。");
    if (!ok) return;

    setDeleting(true);
    setDetailError(null);
    setDetailMessage(null);
    try {
      const response = await fetch(`/api/documents/${detail.id}`, { method: "DELETE" });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "文書の削除に失敗しました。");
      }
      setItems((current) => current.filter((item) => item.id !== detail.id));
      closeDetail();
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "文書の削除に失敗しました。");
    } finally {
      setDeleting(false);
    }
  }

  async function handleReanalyze() {
    if (!detail) return;
    const ok = window.confirm("保存済み画像をもう一度読み取り、OCR項目を更新しますか？");
    if (!ok) return;

    setReanalyzing(true);
    setDetailError(null);
    setDetailMessage(null);
    try {
      const response = await fetch(`/api/documents/${detail.id}/analyze`, {
        method: "POST",
      });
      const result = (await response.json().catch(() => ({}))) as AnalyzeResponse;
      if (!response.ok || !result.extracted) {
        throw new Error(result.error ?? "再解析に失敗しました。");
      }
      const nextHeader = normalizeHeader(result.extracted);
      const nextLineItems = (result.lineItems ?? []).map(lineItemDetailToDraft);
      const apply = window.confirm("再解析結果でOCR項目・明細を上書き保存しますか？");
      if (!apply) {
        setHeaderDraft(nextHeader);
        setLineItemsDraft(nextLineItems);
        setDetailMessage("再解析結果を入力欄に反映しました。保存はまだです。");
        return;
      }
      await patchDetail(
        detail.id,
        { extracted: nextHeader, lineItems: nextLineItems },
        result.warning === "ocr_failed"
          ? "OCRに失敗しました。空の結果で更新しました。"
          : "再解析結果を保存しました。"
      );
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "再解析に失敗しました。");
    } finally {
      setReanalyzing(false);
    }
  }

  function updateLineItem(index: number, field: keyof LineItemDraft, value: string | null) {
    setLineItemsDraft((current) =>
      current.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }

  function addLineItem() {
    setLineItemsDraft((current) => {
      const nextLineNo = current.length > 0 ? Math.max(...current.map((i) => i.line_no)) + 1 : 1;
      return [
        ...current,
        {
          line_no: nextLineNo,
          transaction_date: null,
          description: "",
          quantity: "",
          unit: "",
          unit_price: "",
          amount: "",
          tax_rate: "",
        },
      ];
    });
  }

  function removeLineItem(index: number) {
    setLineItemsDraft((current) =>
      current
        .filter((_, i) => i !== index)
        .map((item, i) => ({ ...item, line_no: i + 1 }))
    );
  }

  const detailDisabled = saving || deleting || reanalyzing || !detail?.canMutate;
  const allChecked = items.length > 0 && items.every((item) => selectedIds.has(item.id));

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 pb-16">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-signal" strokeWidth={1.75} />
          <h1 className="text-lg font-semibold text-ink">請求書ホルダー</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/documents/new?type=invoice"
            className="font-medium text-signal transition-colors hover:text-ink"
          >
            請求書を撮る
          </Link>
          <Link href="/" className="font-medium text-signal transition-colors hover:text-ink">
            ←戻る
          </Link>
        </div>
      </div>

      <p className="mt-2 text-sm text-ink-soft">
        読み取った請求書を一覧表示します。タップで詳細・編集・再解析・削除ができます。
      </p>

      {/* Filters */}
      <div className="mt-5 space-y-3 rounded-lg border border-line bg-white p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-ink">表示範囲</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as ScopeFilter)}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
            >
              <option value="own">自分</option>
              <option value="company">会社公開</option>
              <option value="all">全部</option>
            </select>
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-ink">タグ</span>
            <select
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
            >
              <option value={ALL_TAGS}>すべて</option>
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-ink">発行日（開始）</span>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
            />
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-ink">発行日（終了）</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-ink">金額（下限 ¥）</span>
            <input
              type="number"
              value={amountMin}
              onChange={(event) => setAmountMin(event.target.value)}
              placeholder="例: 10000"
              min={0}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
            />
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-ink">金額（上限 ¥）</span>
            <input
              type="number"
              value={amountMax}
              onChange={(event) => setAmountMax(event.target.value)}
              placeholder="例: 500000"
              min={0}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
            />
          </label>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="block flex-1 space-y-1.5 text-sm">
            <span className="font-medium text-ink">検索</span>
            <div className="flex gap-2">
              <input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applySearch();
                }}
                placeholder="請求番号・請求元・請求先で検索"
                className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
              />
              <button
                type="button"
                onClick={applySearch}
                className="inline-flex items-center gap-1.5 rounded-md bg-signal px-3 py-2 text-sm font-medium text-white transition hover:bg-signal/90"
              >
                <Search className="h-4 w-4" strokeWidth={1.75} />
                検索
              </button>
            </div>
          </label>

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
              グリッド
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
      </div>

      {/* CSV Export Bar */}
      {!loading && items.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleSelectAll}
              className="accent-signal"
              aria-label="すべて選択"
            />
            すべて選択（{items.length}件）
          </label>
          {selectedIds.size > 0 && (
            <span className="text-sm text-ink-soft">{selectedIds.size} 件選択中</span>
          )}
          <button
            type="button"
            disabled={exporting}
            onClick={() => void handleExportCsv()}
            className="inline-flex items-center gap-1.5 rounded-md border border-signal bg-signal px-3 py-1.5 text-sm font-medium text-white transition hover:bg-signal/90 disabled:opacity-50"
          >
            {exporting ? "エクスポート中..." : "CSV エクスポート"}
          </button>
          {exportError && <p className="text-sm text-alert">{exportError}</p>}
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{error}</p>
      )}

      {loading && <p className="mt-8 text-sm text-ink-soft">読み込み中...</p>}

      {!loading && items.length === 0 && (
        <p className="mt-8 text-sm text-ink-soft">条件に合う請求書はありません。</p>
      )}

      {/* Thumbnail Grid */}
      {!loading && items.length > 0 && viewMode === "thumbnail" && (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.id} className="relative">
              <label
                className="absolute left-2 top-2 z-10 flex cursor-pointer items-center"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleCheck(item.id)}
                  className="accent-signal h-4 w-4 rounded"
                  aria-label={`${item.title || "請求番号未設定"}を選択`}
                />
              </label>
              <button
                type="button"
                onClick={() => void loadDetail(item.id)}
                className="group flex h-full w-full flex-col overflow-hidden rounded-md border border-line bg-white text-left transition hover:border-signal/50"
              >
                <div className="relative aspect-3/4 w-full overflow-hidden bg-line">
                  {item.frontImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.frontImageUrl}
                      alt=""
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-ink-soft">
                      画像なし
                    </div>
                  )}
                  {item.companyVisible && (
                    <span className="absolute right-2 top-2 rounded bg-signal px-1.5 py-0.5 text-xs font-bold text-white">
                      会社
                    </span>
                  )}
                  {hasNotes(item.notes) && (
                    <span className="absolute bottom-2 right-2 rounded bg-white/90 p-1 text-signal shadow-sm">
                      <NotesIndicator className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
                <div className="min-w-0 space-y-1 p-2.5">
                  <p className="truncate text-sm font-semibold text-ink">
                    {item.title || "請求番号未設定"}
                  </p>
                  <p className="truncate text-xs text-ink-soft">
                    {item.counterparty || "請求元未設定"}
                  </p>
                  <p className="truncate text-xs text-ink-soft">{formatDate(item.contextDate)}</p>
                  <p className="truncate text-xs font-medium text-ink">
                    {formatAmountYen(item.amountYen)}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* List View */}
      {!loading && items.length > 0 && viewMode === "list" && (
        <ul className="mt-6 divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 px-3 py-2.5">
              <input
                type="checkbox"
                checked={selectedIds.has(item.id)}
                onChange={() => toggleCheck(item.id)}
                className="accent-signal h-4 w-4 shrink-0 rounded"
                aria-label={`${item.title || "請求番号未設定"}を選択`}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                onClick={() => void loadDetail(item.id)}
                className="flex flex-1 items-center gap-3 text-left transition hover:bg-signal-soft/40"
              >
                <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded bg-line">
                  {item.frontImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.frontImageUrl}
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
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
                    <span className="truncate">{item.title || "請求番号未設定"}</span>
                    {hasNotes(item.notes) && <NotesIndicator />}
                    {item.companyVisible && (
                      <span className="rounded bg-signal px-1.5 py-0.5 text-[10px] font-bold text-white">
                        会社
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-soft">
                    {item.counterparty || "請求元未設定"}　{formatDate(item.contextDate)}
                  </p>
                  <p className="mt-0.5 flex items-center gap-2 truncate text-[11px] text-ink-soft">
                    <span className="font-medium text-ink">{formatAmountYen(item.amountYen)}</span>
                    <span>{ownerLabel(item, userId)}</span>
                    {item.tags.length > 0 && <span>{item.tags.join(", ")}</span>}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Load More */}
      {hasMore && nextOffset !== null && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadPage(nextOffset, true)}
            className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
          >
            {loadingMore ? "読み込み中..." : "もっと見る"}
          </button>
        </div>
      )}

      {/* Detail Modal */}
      {selectedId && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoice-detail-title"
          onClick={closeDetail}
        >
          <div
            className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-line bg-white p-4 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-signal">請求書ホルダー</p>
                <h2 id="invoice-detail-title" className="text-base font-semibold text-ink">
                  {detail?.title || selectedSummary?.title || "請求書詳細"}
                </h2>
                <p className="mt-1 text-xs text-ink-soft">
                  {detail
                    ? `${detail.counterparty || "請求元未設定"} / ${formatDate(detail.contextDate)} / 更新 ${formatTimestamp(detail.updatedAt)}`
                    : "詳細を読み込んでいます"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDetail}
                className="text-sm text-ink-soft hover:text-ink"
              >
                閉じる
              </button>
            </div>

            {detailLoading && (
              <p className="mt-4 text-sm text-ink-soft">詳細を読み込み中...</p>
            )}

            {detailError && (
              <p className="mt-3 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
                {detailError}
              </p>
            )}
            {detailMessage && (
              <p className="mt-3 rounded-md bg-signal/10 px-3 py-2 text-sm text-signal">
                {detailMessage}
              </p>
            )}

            {detail && (
              <div className="mt-4 space-y-4">
                {/* Page Images */}
                {detail.images.length > 0 && (
                  <section>
                    <h3 className="mb-2 text-sm font-bold text-ink">ページ画像</h3>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {detail.images.map((image, idx) => (
                        <div
                          key={image.id}
                          className="w-28 shrink-0 overflow-hidden rounded-md border border-line bg-black"
                        >
                          {image.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={image.url}
                              alt={`ページ ${idx + 1}`}
                              className="aspect-3/4 h-full w-full object-contain"
                            />
                          ) : (
                            <div className="flex aspect-3/4 items-center justify-center text-sm text-white/80">
                              画像なし
                            </div>
                          )}
                          <span className="block bg-white px-2 py-1 text-xs font-medium text-ink">
                            {idx + 1} ページ
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Left: Meta + Organize + Header */}
                  <section className="space-y-3">
                    <div className="rounded-md border border-line bg-paper p-3 text-xs text-ink-soft">
                      <p>所有: {ownerLabel(detail, userId)}</p>
                      <p>作成: {formatTimestamp(detail.createdAt)}</p>
                      {!detail.canMutate && (
                        <p className="mt-2 text-alert">
                          閲覧のみです。自分の文書、または編集権限のある会社公開文書だけ変更できます。
                        </p>
                      )}
                    </div>

                    <div className="rounded-lg border border-line bg-paper p-4">
                      <div className="flex items-center gap-2">
                        <BriefcaseBusiness className="h-4 w-4 text-signal" strokeWidth={1.75} />
                        <h3 className="text-sm font-bold text-ink">公開と整理</h3>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className="block space-y-1.5">
                          <span className="text-xs font-medium text-ink-soft">取引日</span>
                          <input
                            type="date"
                            value={contextDateDraft}
                            onChange={(event) => setContextDateDraft(event.target.value)}
                            disabled={detailDisabled}
                            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-60"
                          />
                        </label>
                        <label className="block space-y-1.5">
                          <span className="text-xs font-medium text-ink-soft">タグ</span>
                          <input
                            type="text"
                            value={tagsDraft}
                            onChange={(event) => setTagsDraft(event.target.value)}
                            placeholder="例: 外注費, 2024年度"
                            disabled={detailDisabled}
                            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-60"
                          />
                        </label>
                      </div>

                      <label className="mt-3 inline-flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={companyVisibleDraft}
                          onChange={(event) => setCompanyVisibleDraft(event.target.checked)}
                          disabled={detailDisabled}
                          className="accent-signal disabled:opacity-60"
                        />
                        会社にも公開する
                      </label>

                      <label className="mt-3 block space-y-1.5">
                        <span className="text-sm font-medium text-ink">メモ</span>
                        <textarea
                          value={notesDraft}
                          onChange={(event) => setNotesDraft(event.target.value)}
                          rows={3}
                          disabled={detailDisabled}
                          className="w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-60"
                        />
                      </label>
                    </div>

                    <div className="rounded-lg border border-line bg-white p-4">
                      <h3 className="text-sm font-bold text-ink">ヘッダー項目</h3>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {INVOICE_HEADER_KEYS.map((key) => (
                          <label key={key} className="block space-y-1.5">
                            <span className="text-xs font-medium text-ink-soft">
                              {INVOICE_FIELD_LABELS[key]}
                            </span>
                            <input
                              type="text"
                              value={headerDraft[key]}
                              onChange={(event) =>
                                setHeaderDraft((current) => ({
                                  ...current,
                                  [key]: event.target.value,
                                }))
                              }
                              disabled={detailDisabled}
                              className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-signal focus:ring-1 focus:ring-signal disabled:opacity-60"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </section>

                  {/* Right: Line Items + Actions */}
                  <section className="space-y-3">
                    <div className="rounded-lg border border-line bg-white p-4">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-ink">
                          明細（{lineItemsDraft.length} 行）
                        </h3>
                        {!detailDisabled && (
                          <button
                            type="button"
                            onClick={addLineItem}
                            className="text-xs font-medium text-signal hover:text-ink"
                          >
                            ＋ 行追加
                          </button>
                        )}
                      </div>

                      {lineItemsDraft.length === 0 && (
                        <p className="mt-3 text-xs text-ink-soft">明細はありません。</p>
                      )}

                      {lineItemsDraft.length > 0 && (
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-line text-left text-ink-soft">
                                <th className="pb-1.5 pr-2 font-medium">#</th>
                                <th className="pb-1.5 pr-2 font-medium">明細日付</th>
                                <th className="pb-1.5 pr-2 font-medium">品名</th>
                                <th className="pb-1.5 pr-2 font-medium">数量</th>
                                <th className="pb-1.5 pr-2 font-medium">単位</th>
                                <th className="pb-1.5 pr-2 font-medium">単価</th>
                                <th className="pb-1.5 pr-2 font-medium">金額</th>
                                <th className="pb-1.5 pr-2 font-medium">税率</th>
                                {!detailDisabled && <th className="pb-1.5 font-medium" />}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line/50">
                              {lineItemsDraft.map((item, idx) => (
                                <tr key={idx} className="align-top">
                                  <td className="py-1 pr-2 text-ink-soft">{item.line_no}</td>
                                  <td className="py-1 pr-2">
                                    <input
                                      type="date"
                                      value={item.transaction_date ?? ""}
                                      onChange={(e) =>
                                        updateLineItem(
                                          idx,
                                          "transaction_date",
                                          e.target.value || null
                                        )
                                      }
                                      disabled={detailDisabled}
                                      className="w-28 rounded border border-line bg-paper px-1.5 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                                    />
                                  </td>
                                  <td className="py-1 pr-2">
                                    <input
                                      type="text"
                                      value={item.description}
                                      onChange={(e) =>
                                        updateLineItem(idx, "description", e.target.value)
                                      }
                                      disabled={detailDisabled}
                                      className="w-32 rounded border border-line bg-paper px-1.5 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                                    />
                                  </td>
                                  <td className="py-1 pr-2">
                                    <input
                                      type="text"
                                      value={item.quantity}
                                      onChange={(e) =>
                                        updateLineItem(idx, "quantity", e.target.value)
                                      }
                                      disabled={detailDisabled}
                                      className="w-14 rounded border border-line bg-paper px-1.5 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                                    />
                                  </td>
                                  <td className="py-1 pr-2">
                                    <input
                                      type="text"
                                      value={item.unit}
                                      onChange={(e) =>
                                        updateLineItem(idx, "unit", e.target.value)
                                      }
                                      disabled={detailDisabled}
                                      className="w-12 rounded border border-line bg-paper px-1.5 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                                    />
                                  </td>
                                  <td className="py-1 pr-2">
                                    <input
                                      type="text"
                                      value={item.unit_price}
                                      onChange={(e) =>
                                        updateLineItem(idx, "unit_price", e.target.value)
                                      }
                                      disabled={detailDisabled}
                                      className="w-20 rounded border border-line bg-paper px-1.5 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                                    />
                                  </td>
                                  <td className="py-1 pr-2">
                                    <input
                                      type="text"
                                      value={item.amount}
                                      onChange={(e) =>
                                        updateLineItem(idx, "amount", e.target.value)
                                      }
                                      disabled={detailDisabled}
                                      className="w-20 rounded border border-line bg-paper px-1.5 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                                    />
                                  </td>
                                  <td className="py-1 pr-2">
                                    <select
                                      value={item.tax_rate}
                                      onChange={(e) =>
                                        updateLineItem(idx, "tax_rate", e.target.value)
                                      }
                                      disabled={detailDisabled}
                                      className="w-16 rounded border border-line bg-paper px-1.5 py-1 text-xs outline-none focus:border-signal disabled:opacity-60"
                                    >
                                      <option value="">—</option>
                                      <option value="10">10%</option>
                                      <option value="8">8%</option>
                                    </select>
                                  </td>
                                  {!detailDisabled && (
                                    <td className="py-1">
                                      <button
                                        type="button"
                                        onClick={() => removeLineItem(idx)}
                                        className="text-alert hover:text-alert/70"
                                        aria-label="行削除"
                                      >
                                        ✕
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveDetail()}
                        disabled={detailDisabled}
                        className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition hover:bg-signal/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? "保存中..." : "編集内容を保存"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleReanalyze()}
                        disabled={detailDisabled}
                        className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
                      >
                        <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
                        {reanalyzing ? "読取中..." : "もう一度読む"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete()}
                        disabled={detailDisabled}
                        className="rounded-md bg-alert px-4 py-2 text-sm font-medium text-white transition hover:bg-alert/90 disabled:opacity-50"
                      >
                        {deleting ? "削除中..." : "削除"}
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
