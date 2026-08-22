import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/layout/AdminHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { getViewerContext } from "@/lib/auth/getViewerContext";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isDeveloper } = await getViewerContext();

  // Access control lives here, once, for every page under (admin) —
  // /admin, /debug, and anything added later all inherit this guard.
  if (!isDeveloper) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AdminHeader />
      <main className="flex flex-1">{children}</main>
      <SiteFooter fullWidth />
    </div>
  );
}
