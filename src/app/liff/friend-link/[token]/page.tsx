import { LiffFriendLinkView } from "./LiffFriendLinkView";

export default function LiffFriendLinkPage({ params }: { params: { token: string } }) {
  return <LiffFriendLinkView inviteToken={params.token} />;
}
