"use client";

import { useEffect, useState } from "react";

type FriendLinkState = "loading" | "error" | "expired" | "already_used";

const ERROR_MESSAGES: Record<FriendLinkState, string> = {
  loading: "読み込み中...",
  error: "連携に失敗しました。もう一度お試しください。",
  expired: "招待の有効期限が切れています。管理者に再発行を依頼してください。",
  already_used: "この招待は既に使用されています。",
};

interface LiffFriendLinkViewProps {
  inviteToken: string;
}

export function LiffFriendLinkView({ inviteToken }: LiffFriendLinkViewProps) {
  const [state, setState] = useState<FriendLinkState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const liffModule = await import("@line/liff");
        const liff = liffModule.default;
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID! });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const idToken = liff.getIDToken();
        if (!idToken) {
          if (!cancelled) setState("error");
          return;
        }

        const res = await fetch("/api/line/friend-link-accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, inviteToken }),
        });

        if (res.ok) {
          window.location.assign("/");
          return;
        }

        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (body.error === "expired") setState("expired");
          else if (body.error === "already_used") setState("already_used");
          else setState("error");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  return (
    <p className="p-6 text-center text-sm text-ink-soft">
      {state === "loading" ? ERROR_MESSAGES[state] : <span className="text-alert">{ERROR_MESSAGES[state]}</span>}
    </p>
  );
}
