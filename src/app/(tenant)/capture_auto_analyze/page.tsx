import { redirect } from "next/navigation";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { MonitorAnalyzeView } from "./MonitorAnalyzeView";

export default async function CaptureAutoAnalyzePage() {
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

  return <MonitorAnalyzeView tenantId={tenant.tenantId} userId={viewer.userId} />;
}
