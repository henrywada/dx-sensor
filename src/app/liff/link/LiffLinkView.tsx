"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type LinkState = "loading" | "missing_token" | "error" | "expired" | "already_used";

const ERROR_MESSAGES: Record<Exclude<LinkState, "loading">, string> = {
  missing_token: "招待リンクが正しくありません。",
  expired: "招待の有効期限が切れています。管理者に再発行を依頼してください。",
  already_used: "この招待は既に使用されています。",
  error: "連携に失敗しました。もう一度お試しください。",
};

export function LiffLinkView() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<LinkState>("loading");

  useEffect(() => {
    const inviteToken = searchParams.get("t");
    if (!inviteToken) {
      setState("missing_token");
      return;
    }

    let cancelled = false;

    async function run(token: string) {
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

        const res = await fetch("/api/line/invite-accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken, inviteToken: token }),
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

    run(inviteToken);
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  if (state === "loading") {
    return <p className="p-6 text-center text-sm text-ink-soft">読み込み中...</p>;
  }

  return <p className="p-6 text-center text-sm text-alert">{ERROR_MESSAGES[state]}</p>;
}
