export interface InvoiceExportLineItem {
  line_no: number;
  transaction_date: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string | number | null;
  amount: string | number | null;
  tax_rate: string;
}

/** summary: 請求書1件=1行（明細列は空）。with_line_items: 明細1行=1CSV行 */
export type InvoiceCsvExportMode = "summary" | "with_line_items";

export interface InvoiceExportDocument {
  id: string;
  title: string;
  counterparty: string;
  contextDate: string | null;
  amountYen: number | null;
  notes: string;
  tags: string[];
  extracted: Record<string, string>;
  lineItems: InvoiceExportLineItem[];
}

/** CSV 1行目の列名（spec 25列） */
export const INVOICE_CSV_HEADERS = [
  "請求書ID",
  "請求番号",
  "発行日",
  "支払期限",
  "請求先",
  "請求元",
  "登録番号",
  "小計",
  "消費税10%",
  "消費税8%",
  "消費税合計",
  "合計",
  "振込先",
  "備考",
  "メモ",
  "タグ",
  "取引日",
  "明細行番号",
  "明細日付",
  "品名",
  "数量",
  "単位",
  "単価",
  "金額",
  "税率",
] as const;

function stringField(value: string | undefined): string {
  return value ?? "";
}

function formatCsvValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function encodeCsvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

const EMPTY_LINE_ITEM_COLUMNS = ["", "", "", "", "", "", "", ""] as const;

function buildInvoiceHeaderColumns(doc: InvoiceExportDocument): string[] {
  return [
    doc.id,
    doc.title,
    stringField(doc.extracted.issue_date),
    stringField(doc.extracted.due_date),
    stringField(doc.extracted.recipient_name),
    doc.counterparty,
    stringField(doc.extracted.registration_number),
    stringField(doc.extracted.subtotal),
    stringField(doc.extracted.tax_10),
    stringField(doc.extracted.tax_8),
    stringField(doc.extracted.tax_total),
    formatCsvValue(doc.amountYen),
    stringField(doc.extracted.bank_info),
    stringField(doc.extracted.remarks),
    doc.notes,
    doc.tags.join("|"),
    formatCsvValue(doc.contextDate),
  ];
}

export function buildInvoiceCsvRows(
  documents: InvoiceExportDocument[],
  mode: InvoiceCsvExportMode = "summary"
): string[][] {
  const rows: string[][] = [];

  for (const doc of documents) {
    const headerColumns = buildInvoiceHeaderColumns(doc);

    if (mode === "summary") {
      rows.push([...headerColumns, ...EMPTY_LINE_ITEM_COLUMNS]);
      continue;
    }

    const sortedLineItems = [...doc.lineItems].sort(
      (a, b) => a.line_no - b.line_no
    );

    if (sortedLineItems.length === 0) {
      rows.push([...headerColumns, ...EMPTY_LINE_ITEM_COLUMNS]);
      continue;
    }

    for (const item of sortedLineItems) {
      rows.push([
        ...headerColumns,
        formatCsvValue(item.line_no),
        formatCsvValue(item.transaction_date),
        item.description,
        item.quantity,
        item.unit,
        formatCsvValue(item.unit_price),
        formatCsvValue(item.amount),
        item.tax_rate,
      ]);
    }
  }

  return rows;
}

export function buildInvoiceCsvRowsWithHeader(
  documents: InvoiceExportDocument[],
  mode: InvoiceCsvExportMode = "summary"
): string[][] {
  return [[...INVOICE_CSV_HEADERS], ...buildInvoiceCsvRows(documents, mode)];
}

export function encodeCsvWithBom(rows: string[][]): Buffer {
  const body = rows.map(encodeCsvRow).join("\n");
  return Buffer.from("\uFEFF" + body, "utf-8");
}
