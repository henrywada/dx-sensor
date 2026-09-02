import { Suspense } from "react";
import { LiffLinkView } from "./LiffLinkView";

export default function LiffLinkPage() {
  return (
    <Suspense
      fallback={<p className="p-6 text-center text-sm text-ink-soft">読み込み中...</p>}
    >
      <LiffLinkView />
    </Suspense>
  );
}
