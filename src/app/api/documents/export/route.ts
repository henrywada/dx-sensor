import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import {
  buildInvoiceCsvRowsWithHeader,
  buildPurchaseOrderCsvRowsWithHeader,
  encodeCsvWithBom,
} from "@/lib/documents/exportCsv";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  type DocumentRow,
  type LineItemRow,
  exportFilenameTimestamp,
  parseExportBody,
  toExportDocument,
} from "./parseExportBody";

export async function POST(req: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant) {
    return NextResponse.json({ error: "所属テナントが見つかりません" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const parsed = parseExportBody(body);
  if (!parsed) {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("captured_documents")
    .select(
      "id, title, counterparty, context_date, amount_yen, notes, tags, extracted"
    )
    .eq("tenant_id", tenant.tenantId)
    .eq("document_type", parsed.documentType)
    .in("id", parsed.documentIds);

  if (error) {
    console.error("captured_documents export fetch failed", error);
    return NextResponse.json({ error: "文書の取得に失敗しました" }, { status: 500 });
  }

  const readableRows = (data ?? []) as DocumentRow[];
  if (readableRows.length === 0) {
    return NextResponse.json({ error: "文書が見つかりません" }, { status: 404 });
  }

  const readableIds = readableRows.map((row) => row.id);
  const { data: lineItemRows, error: lineItemsError } = await supabase
    .from("captured_document_line_items")
    .select(
      "document_id, line_no, transaction_date, description, quantity, unit, unit_price, amount, tax_rate"
    )
    .in("document_id", readableIds)
    .order("line_no", { ascending: true });

  if (lineItemsError) {
    console.error("captured_document_line_items export fetch failed", lineItemsError);
    return NextResponse.json({ error: "明細の取得に失敗しました" }, { status: 500 });
  }

  const lineItemsByDocument = new Map<string, LineItemRow[]>();
  for (const item of (lineItemRows ?? []) as LineItemRow[]) {
    const existing = lineItemsByDocument.get(item.document_id) ?? [];
    existing.push(item);
    lineItemsByDocument.set(item.document_id, existing);
  }

  const rowById = new Map(readableRows.map((row) => [row.id, row]));
  const documents = parsed.documentIds
    .map((id) => rowById.get(id))
    .filter((row): row is DocumentRow => row !== undefined)
    .map((row) => toExportDocument(row, lineItemsByDocument.get(row.id) ?? []));

  const csvRows =
    parsed.documentType === "purchase_order"
      ? buildPurchaseOrderCsvRowsWithHeader(documents, parsed.exportMode)
      : buildInvoiceCsvRowsWithHeader(documents, parsed.exportMode);
  const bodyBuffer = encodeCsvWithBom(csvRows);
  const timestamp = exportFilenameTimestamp();
  const filenamePrefix =
    parsed.documentType === "purchase_order" ? "purchase_orders" : "invoices";

  return new Response(new Uint8Array(bodyBuffer), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenamePrefix}_${timestamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
