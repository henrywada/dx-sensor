import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { CaptureAutoForm } from "./CaptureAutoForm";

export default async function CaptureAutoPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant) {
    return (
      <div className="p-6">
        <p>所属テナントが見つかりません。管理者にお問い合わせください。</p>
      </div>
    );
  }

  return <CaptureAutoForm tenantId={tenant.tenantId} userId={viewer.userId} />;
}
