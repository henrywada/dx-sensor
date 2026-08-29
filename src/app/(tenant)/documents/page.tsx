import { notFound, redirect } from "next/navigation";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { DocumentsAlbum } from "./DocumentsAlbum";
import { InvoiceAlbum } from "./InvoiceAlbum";
import { PurchaseOrderAlbum } from "./PurchaseOrderAlbum";

interface DocumentsPageProps {
  searchParams?: {
    type?: string;
    open?: string;
  };
}

export default async function DocumentsPage({ searchParams }: DocumentsPageProps) {
  const documentType = searchParams?.type ?? "business_card";

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
      <DocumentsAlbum
        documentType={documentType}
        userId={viewer.userId}
        initialOpenId={searchParams?.open ?? null}
      />
    );
  }

  if (documentType === "invoice") {
    return (
      <InvoiceAlbum
        documentType={documentType}
        userId={viewer.userId}
        initialOpenId={searchParams?.open ?? null}
      />
    );
  }

  if (documentType === "purchase_order") {
    return (
      <PurchaseOrderAlbum
        documentType={documentType}
        userId={viewer.userId}
        initialOpenId={searchParams?.open ?? null}
      />
    );
  }

  notFound();
}
