import { redirect } from "next/navigation";
import { AppHeader } from "@/components/layout/AppHeader";
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
      <AppHeader variant="admin" isDeveloper={isDeveloper} />
      <main className="flex min-w-0 flex-1 overflow-x-hidden">{children}</main>
      <SiteFooter fullWidth />
    </div>
  );
}
