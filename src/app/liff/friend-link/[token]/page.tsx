import { Suspense } from "react";
import { LiffFriendLinkView } from "./LiffFriendLinkView";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function LiffFriendLinkPage({ params }: Props) {
  const { token } = await params;

  return (
    <Suspense
      fallback={<p className="p-6 text-center text-sm text-ink-soft">読み込み中...</p>}
    >
      <LiffFriendLinkView inviteToken={token} />
    </Suspense>
  );
}
