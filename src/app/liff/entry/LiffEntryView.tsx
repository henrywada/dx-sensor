"use client";

import { useEffect, useState } from "react";

type AuthState = "loading" | "not_linked" | "error";

export function LiffEntryView() {
  const [state, setState] = useState<AuthState>("loading");

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

        const res = await fetch("/api/line/liff-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });

        if (res.ok) {
          window.location.assign("/");
          return;
        }

        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          setState(body.error === "not_linked" ? "not_linked" : "error");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "loading") {
    return <p className="p-6 text-center text-sm text-ink-soft">読み込み中...</p>;
  }

  if (state === "not_linked") {
    return (
      <div className="space-y-2 p-6 text-center text-sm text-ink-soft">
        <p>まだアカウントが連携されていません。</p>
        <p>管理者から共有された招待用リンクからアクセスしてください。</p>
      </div>
    );
  }

  return (
    <div className="p-6 text-center text-sm text-alert">
      <p>読み込みに失敗しました。もう一度お試しください。</p>
    </div>
  );
}
