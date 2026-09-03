"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

type CallbackState = "loading" | "error";

export default function SignupCallbackPage() {
  const [state, setState] = useState<CallbackState>("loading");
  const firedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        if (!cancelled) setState("error");
        return;
      }

      if (firedRef.current) return;
      firedRef.current = true;

      try {
        const res = await fetch("/api/signup/provision", { method: "POST" });
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          if (!cancelled) setState("error");
          return;
        }

        window.location.assign(body.redirectTo ?? body.inviteUrl ?? "/");
      } catch {
        if (!cancelled) setState("error");
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-6">
        <div className="w-full max-w-sm space-y-3 text-center text-sm text-ink">
          <p className="text-alert">リンクの有効期限が切れているか、無効です。</p>
          <a href="/signup" className="text-signal underline">
            もう一度登録する
          </a>
        </div>
      </div>
    );
  }

  return <p className="p-6 text-center text-sm text-ink-soft">読み込み中...</p>;
}
