import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { CaptureForm } from "./CaptureForm";

export default async function CapturePage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant) {
    // tenant_members に行が無いユーザー(招待未完了等)
    return (
      <div className="p-6">
        <p>所属テナントが見つかりません。管理者にお問い合わせください。</p>
      </div>
    );
  }

  return <CaptureForm tenantId={tenant.tenantId} userId={viewer.userId} />;
}
