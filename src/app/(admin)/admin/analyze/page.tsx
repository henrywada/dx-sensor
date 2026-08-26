import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { AnalyzeWorkbench } from "./AnalyzeWorkbench";

export default async function AnalyzePage() {
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

  return <AnalyzeWorkbench tenantId={tenant.tenantId} />;
}
