import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { isLiffClientUserAgent } from "@/lib/line/isLiffClientUserAgent";

export default async function TenantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, email, isDeveloper } = await getViewerContext();

  // TOP画面はログイン必須。未ログインならログイン画面へ。
  if (!userId) {
    redirect("/login");
  }

  const tenant = await getActiveTenant(userId);
  const isLiffClient = isLiffClientUserAgent(headers().get("user-agent"));

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AppHeader
        variant="tenant"
        isDeveloper={isDeveloper}
        tenantRole={tenant?.role}
        email={email}
        hideLogoutButton={isLiffClient}
      />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
