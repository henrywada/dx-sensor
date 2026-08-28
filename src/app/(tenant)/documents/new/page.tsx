import { notFound, redirect } from "next/navigation";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { tokyoToday } from "@/lib/documents/tokyoDate";
import { CaptureDocumentForm } from "./CaptureDocumentForm";
import { InvoiceCaptureForm } from "./InvoiceCaptureForm";

interface NewDocumentPageProps {
  searchParams?: {
    type?: string;
  };
}

export default async function NewDocumentPage({
  searchParams,
}: NewDocumentPageProps) {
  const documentType = searchParams?.type;
  if (documentType !== "business_card" && documentType !== "invoice") notFound();

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

  if (documentType === "business_card") {
    return (
      <CaptureDocumentForm
        tenantId={tenant.tenantId}
        userId={viewer.userId}
        defaultContextDate={tokyoToday()}
        documentType={documentType}
      />
    );
  }

  return (
    <InvoiceCaptureForm
      tenantId={tenant.tenantId}
      userId={viewer.userId}
    />
  );
}
