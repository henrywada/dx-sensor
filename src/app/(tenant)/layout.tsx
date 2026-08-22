import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { getViewerContext } from "@/lib/auth/getViewerContext";

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

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SiteHeader isDeveloper={isDeveloper} email={email} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
