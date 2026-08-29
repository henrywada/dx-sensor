import type {
  InvoiceCsvExportMode,
  InvoiceExportDocument,
  InvoiceExportLineItem,
  ReceiptExportDocument,
} from "@/lib/documents/exportCsv";
import { getDocumentPlugin } from "@/lib/documents/registry";

export type ExportBody = {
  documentType?: unknown;
  documentMode?: unknown;
  documentIds?: unknown;
  exportMode?: unknown;
};

export type DocumentRow = {
  id: string;
  title: string;
  counterparty: string;
  context_date: string | null;
  amount_yen: number | string | null;
  notes: string;
  tags: string[];
  extracted: unknown;
};

export type LineItemRow = {
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

export function exportFilenameTimestamp(now = new Date()): string {
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

export const EXPORTABLE_TYPES = new Set(["invoice", "purchase_order", "receipt"]);

function parseExportMode(value: unknown): InvoiceCsvExportMode {
  if (value === "with_line_items") return "with_line_items";
  return "summary";
}

function parseDocumentMode(documentType: string, value: unknown): string | null | undefined {
  const plugin = getDocumentPlugin(documentType);
  if (!plugin?.modes || plugin.modes.length === 0) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const mode = plugin.modes.find((m) => m.id === value);
  return mode ? mode.id : undefined;
}

export function parseExportBody(body: unknown): {
  documentType: string;
  documentMode: string | null;
  documentIds: string[];
  exportMode: InvoiceCsvExportMode;
} | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const { documentType, documentMode, documentIds, exportMode } = body as ExportBody;
  if (typeof documentType !== "string" || !EXPORTABLE_TYPES.has(documentType)) return null;
  if (!Array.isArray(documentIds) || documentIds.length === 0) return null;
  if (documentIds.length > 100) return null;
  if (!documentIds.every((id) => typeof id === "string" && id.length > 0)) {
    return null;
  }

  const resolvedMode = parseDocumentMode(documentType, documentMode);
  if (resolvedMode === undefined) return null;

  return {
    documentType,
    documentMode: resolvedMode,
    documentIds,
    exportMode: parseExportMode(exportMode),
  };
}

export function toExportLineItem(row: LineItemRow): InvoiceExportLineItem {
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

export function toExportDocument(
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

export function toReceiptExportDocument(row: DocumentRow): ReceiptExportDocument {
  return {
    id: row.id,
    title: row.title,
    counterparty: row.counterparty,
    contextDate: row.context_date,
    amountYen: parseAmountYen(row.amount_yen),
    notes: row.notes ?? "",
    tags: row.tags ?? [],
    extracted: asExtracted(row.extracted),
  };
}
