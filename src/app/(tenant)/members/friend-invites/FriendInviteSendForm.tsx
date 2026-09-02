"use client";

import { useState } from "react";
import type { FriendInviteCandidate } from "@/lib/line/friendInviteCandidates";

type SendResult = { userId: string; ok: boolean; error?: string };

export function FriendInviteSendForm({
  candidates,
}: {
  candidates: FriendInviteCandidate[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleSend() {
    if (selected.size === 0) return;
    setSending(true);
    setResults(null);
    setSendError(null);
    try {
      const res = await fetch("/api/tenant-members/friend-invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...selected] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendError(typeof body.error === "string" ? body.error : "送信に失敗しました。");
        return;
      }
      setResults(body.results ?? []);
    } catch {
      setSendError("送信に失敗しました。通信環境を確認してください。");
    } finally {
      setSending(false);
    }
  }

  if (candidates.length === 0) {
    return <p className="text-sm text-ink-soft">未フォローのメンバーはいません。</p>;
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-lg border border-line bg-white">
        {candidates.map((candidate) => (
          <li key={candidate.userId} className="flex items-center gap-3 p-3">
            <input
              type="checkbox"
              checked={selected.has(candidate.userId)}
              onChange={() => toggle(candidate.userId)}
            />
            <span className="text-sm text-ink">{candidate.email}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={handleSend}
        disabled={selected.size === 0 || sending}
        className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {sending ? "送信中..." : "友だち招待の送信"}
      </button>

      {sendError && <p className="text-sm text-alert">{sendError}</p>}

      {results && (
        <ul className="space-y-1 text-sm">
          {results.map((result) => {
            const candidate = candidates.find((c) => c.userId === result.userId);
            return (
              <li key={result.userId} className={result.ok ? "text-ink" : "text-alert"}>
                {candidate?.email ?? result.userId}
                {": "}
                {result.ok ? "送信しました" : `送信失敗（${result.error}）`}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
