"use client";

import { Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type PictureSendSubject = {
  id: string;
  label: string;
  created_at: string;
  updated_at: string;
};

interface SubjectManageModalProps {
  open: boolean;
  userId: string;
  onClose: () => void;
  onSubjectsChanged: () => void;
}

type EditMode = { kind: "none" } | { kind: "add" } | { kind: "edit"; id: string; label: string };

export function SubjectManageModal({
  open,
  userId,
  onClose,
  onSubjectsChanged,
}: SubjectManageModalProps) {
  const supabase = createClient();
  const [subjects, setSubjects] = useState<PictureSendSubject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>({ kind: "none" });
  const [draftLabel, setDraftLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from("picture_send_subjects")
      .select("id, label, created_at, updated_at")
      .order("label");

    if (fetchError) {
      setError(fetchError.message);
      setSubjects([]);
    } else {
      setSubjects(data ?? []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    setEditMode({ kind: "none" });
    setDraftLabel("");
    void loadSubjects();
  }, [open, loadSubjects]);

  if (!open) return null;

  async function handleSave() {
    const trimmed = draftLabel.trim();
    if (!trimmed) {
      setError("件名を入力してください。");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (editMode.kind === "add") {
        const { error: insertError } = await supabase
          .from("picture_send_subjects")
          .insert({ user_id: userId, label: trimmed });

        if (insertError) throw insertError;
      } else if (editMode.kind === "edit") {
        const { error: updateError } = await supabase
          .from("picture_send_subjects")
          .update({ label: trimmed, updated_at: new Date().toISOString() })
          .eq("id", editMode.id);

        if (updateError) throw updateError;
      }

      setEditMode({ kind: "none" });
      setDraftLabel("");
      await loadSubjects();
      onSubjectsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, label: string) {
    if (!window.confirm(`「${label}」を削除しますか？`)) return;

    setError(null);
    const { error: deleteError } = await supabase
      .from("picture_send_subjects")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    if (editMode.kind === "edit" && editMode.id === id) {
      setEditMode({ kind: "none" });
      setDraftLabel("");
    }

    await loadSubjects();
    onSubjectsChanged();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="subject-modal-title"
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-hidden rounded-lg border border-line bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 id="subject-modal-title" className="flex items-center gap-2 text-base font-semibold text-ink">
            <Tag className="h-4 w-4 text-signal" strokeWidth={1.75} />
            ID登録
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-soft transition hover:bg-line hover:text-ink"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[calc(85vh-8rem)] overflow-y-auto px-4 py-4">
          <p className="text-sm text-ink-soft">
            繰り返し使う件名（例: 日報）を登録します。1回限りの件名は送信画面で都度入力してください。
          </p>

          {error && (
            <p className="mt-3 rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{error}</p>
          )}

          {editMode.kind !== "none" && (
            <div className="mt-4 space-y-2 rounded-md border border-line bg-paper p-3">
              <label className="block text-sm font-medium text-ink">
                {editMode.kind === "add" ? "新規件名" : "件名を変更"}
              </label>
              <input
                type="text"
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                placeholder="例: 日報"
                className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-signal focus:ring-1 focus:ring-signal"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="rounded-md bg-signal px-3 py-1.5 text-sm font-medium text-white transition hover:bg-signal/90 disabled:opacity-50"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setEditMode({ kind: "none" });
                    setDraftLabel("");
                    setError(null);
                  }}
                  className="rounded-md border border-line px-3 py-1.5 text-sm text-ink transition hover:border-signal/50"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={editMode.kind !== "none"}
            onClick={() => {
              setEditMode({ kind: "add" });
              setDraftLabel("");
              setError(null);
            }}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-signal/40 px-3 py-2 text-sm font-medium text-signal transition hover:border-signal disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            件名を追加
          </button>

          <ul className="mt-4 space-y-2">
            {loading && (
              <li className="text-sm text-ink-soft">読み込み中...</li>
            )}
            {!loading && subjects.length === 0 && (
              <li className="text-sm text-ink-soft">登録済みの件名はありません。</li>
            )}
            {subjects.map((subject) => (
              <li
                key={subject.id}
                className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{subject.label}</span>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={editMode.kind !== "none"}
                    onClick={() => {
                      setEditMode({ kind: "edit", id: subject.id, label: subject.label });
                      setDraftLabel(subject.label);
                      setError(null);
                    }}
                    className="rounded-md p-1.5 text-ink-soft transition hover:bg-line hover:text-signal disabled:opacity-50"
                    aria-label={`${subject.label} を編集`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={editMode.kind !== "none"}
                    onClick={() => void handleDelete(subject.id, subject.label)}
                    className="rounded-md p-1.5 text-ink-soft transition hover:bg-alert/10 hover:text-alert disabled:opacity-50"
                    aria-label={`${subject.label} を削除`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
