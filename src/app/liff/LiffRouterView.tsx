"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveLiffStatePath } from "@/lib/line/resolveLiffStatePath";

export function LiffRouterView() {
  const router = useRouter();
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const liffModule = await import("@line/liff");
        const liff = liffModule.default;
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID! });

        const liffState = new URLSearchParams(window.location.search).get("liff.state");
        const destination = resolveLiffStatePath(liffState);
        if (!cancelled) router.replace(destination);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return (
      <p className="p-6 text-center text-sm text-alert">
        読み込みに失敗しました。もう一度お試しください。
      </p>
    );
  }

  return <p className="p-6 text-center text-sm text-ink-soft">読み込み中...</p>;
}
