import { redirect } from "next/navigation";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { listFriendInviteCandidates } from "@/lib/line/friendInviteCandidates";
import { FriendInviteSendForm } from "./FriendInviteSendForm";

const ALLOWED_ROLES = new Set(["owner", "admin", "developer"]);

export default async function FriendInvitesPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-ink">
        <div className="rounded-lg border border-line bg-paper p-4">
          所属テナントが見つかりません。管理者にお問い合わせください。
        </div>
      </div>
    );
  }

  if (!ALLOWED_ROLES.has(tenant.role)) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-ink">
        <div className="rounded-lg border border-line bg-paper p-4">
          この画面へのアクセス権限がありません。
        </div>
      </div>
    );
  }

  const candidates = await listFriendInviteCandidates(tenant.tenantId);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-semibold text-ink">LINE友だち招待</h1>
      <p className="text-sm text-ink-soft">
        まだLINE公式アカウントを友だち追加していないメンバーに、招待メールを送信します。
      </p>
      <FriendInviteSendForm candidates={candidates} />
    </div>
  );
}
