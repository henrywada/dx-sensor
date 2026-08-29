import { notFound, redirect } from "next/navigation";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { tokyoToday } from "@/lib/documents/tokyoDate";
import { CaptureDocumentForm } from "./CaptureDocumentForm";
import { InvoiceCaptureForm } from "./InvoiceCaptureForm";
import { PurchaseOrderCaptureForm } from "./PurchaseOrderCaptureForm";
import { ReceiptCaptureForm } from "./ReceiptCaptureForm";

const ALLOWED_TYPES = [
  "business_card",
  "invoice",
  "purchase_order",
  "receipt",
] as const;

interface NewDocumentPageProps {
  searchParams?: {
    type?: string;
  };
}

export default async function NewDocumentPage({
  searchParams,
}: NewDocumentPageProps) {
  const documentType = searchParams?.type;
  if (!ALLOWED_TYPES.includes(documentType as (typeof ALLOWED_TYPES)[number])) {
    notFound();
  }

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

  if (documentType === "purchase_order") {
    return (
      <PurchaseOrderCaptureForm
        tenantId={tenant.tenantId}
        userId={viewer.userId}
      />
    );
  }

  if (documentType === "receipt") {
    return (
      <ReceiptCaptureForm
        tenantId={tenant.tenantId}
        userId={viewer.userId}
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
