import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";

const ALLOWED_ROLES = new Set(["developer", "admin_tenant"]);

export default async function AdminTenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await getViewerContext();

  // Access control lives here, once, for every page under (admin_tenant) —
  // role='developer' または role='admin_tenant' 以外はアクセスできない。
  if (!userId) {
    redirect("/login");
  }

  const tenant = await getActiveTenant(userId);
  if (!tenant || !ALLOWED_ROLES.has(tenant.role)) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AppHeader variant="admin" />
      <main className="flex min-w-0 flex-1 overflow-x-hidden">{children}</main>
      <SiteFooter fullWidth />
    </div>
  );
}
