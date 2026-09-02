import { buildFriendInviteLiffUrl, generateFriendInviteQrDataUrl } from "@/lib/line/friendInviteQrCode";
import { createServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-md p-6 text-sm text-ink">
      <div className="rounded-lg border border-line bg-paper p-4 text-alert">{message}</div>
    </div>
  );
}

export default async function LineFriendInvitePage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createServiceSupabase();

  const { data: invite } = await supabase
    .from("line_friend_invites")
    .select("expires_at, used_at")
    .eq("invite_token", params.token)
    .maybeSingle();

  if (!invite) {
    return <ErrorNotice message="このリンクは無効です。" />;
  }
  if (invite.used_at) {
    return <ErrorNotice message="このリンクは既に使用されています。" />;
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return <ErrorNotice message="このリンクの有効期限が切れています。管理者に再発行を依頼してください。" />;
  }

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    console.error("NEXT_PUBLIC_LIFF_ID is not configured");
    return <ErrorNotice message="現在この機能はご利用いただけません。" />;
  }

  const liffUrl = buildFriendInviteLiffUrl(liffId, params.token);
  const qrDataUrl = await generateFriendInviteQrDataUrl(liffUrl);

  return (
    <div className="mx-auto max-w-md space-y-4 p-6 text-center">
      <p className="text-sm text-ink">
        LINEアプリのカメラ（またはQRコードリーダー）で、下のQRコードを読み取ってください。
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrDataUrl}
        alt="LINE友だち追加QRコード"
        width={320}
        height={320}
        className="mx-auto"
      />
      <p className="text-xs text-ink-soft">読み取ると友だち追加とアカウント連携が完了します。</p>
    </div>
  );
}
