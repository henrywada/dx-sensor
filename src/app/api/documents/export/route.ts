import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import {
  buildInvoiceCsvRowsWithHeader,
  encodeCsvWithBom,
  type InvoiceExportDocument,
  type InvoiceExportLineItem,
} from "@/lib/documents/exportCsv";
import { createServerSupabase } from "@/lib/supabase/server";

type ExportBody = {
  documentType?: unknown;
  documentIds?: unknown;
};

type DocumentRow = {
  id: string;
  title: string;
  counterparty: string;
  context_date: string | null;
  amount_yen: number | string | null;
  notes: string;
  tags: string[];
  extracted: unknown;
};

type LineItemRow = {
  document_id: string;
  line_no: number;
  transaction_date: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: number | null;
  amount: number | null;
  tax_rate: string;
};

function asExtracted(value: unknown): Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

function parseAmountYen(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function exportFilenameTimestamp(now = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}

function parseExportBody(body: unknown): { documentType: string; documentIds: string[] } | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const { documentType, documentIds } = body as ExportBody;
  if (documentType !== "invoice") return null;
  if (!Array.isArray(documentIds) || documentIds.length === 0) return null;
  if (documentIds.length > 100) return null;
  if (!documentIds.every((id) => typeof id === "string" && id.length > 0)) {
    return null;
  }

  return { documentType, documentIds };
}

function toExportLineItem(row: LineItemRow): InvoiceExportLineItem {
  return {
    line_no: row.line_no,
    transaction_date: row.transaction_date,
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    unit_price: row.unit_price,
    amount: row.amount,
    tax_rate: row.tax_rate,
  };
}

function toExportDocument(
  row: DocumentRow,
  lineItems: LineItemRow[]
): InvoiceExportDocument {
  return {
    id: row.id,
    title: row.title,
    counterparty: row.counterparty,
    contextDate: row.context_date,
    amountYen: parseAmountYen(row.amount_yen),
    notes: row.notes ?? "",
    tags: row.tags ?? [],
    extracted: asExtracted(row.extracted),
    lineItems: lineItems.map(toExportLineItem),
  };
}

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
    .eq("document_type", "invoice")
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

  const csvRows = buildInvoiceCsvRowsWithHeader(documents);
  const bodyBuffer = encodeCsvWithBom(csvRows);
  const timestamp = exportFilenameTimestamp();

  return new Response(new Uint8Array(bodyBuffer), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices_${timestamp}.csv"`,
    },
  });
}
