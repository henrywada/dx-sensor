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

/** Excel/Google Sheets 等でのCSVフォーミュラインジェクションを防ぐため、数式と解釈されうる先頭文字をエスケープする */
function guardFormulaInjection(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function escapeCsvField(value: string): string {
  const guarded = guardFormulaInjection(value);
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
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

export interface PurchaseOrderExportDocument {
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

/** CSV 1行目の列名（発注書 26列） */
export const PURCHASE_ORDER_CSV_HEADERS = [
  "発注書ID",
  "発注番号",
  "発行日",
  "納期",
  "発注先",
  "発注元",
  "登録番号",
  "納品場所",
  "支払条件",
  "小計",
  "消費税10%",
  "消費税8%",
  "消費税合計",
  "合計",
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

function buildPurchaseOrderHeaderColumns(doc: PurchaseOrderExportDocument): string[] {
  return [
    doc.id,
    doc.title,
    stringField(doc.extracted.issue_date),
    stringField(doc.extracted.delivery_date),
    doc.counterparty,
    stringField(doc.extracted.issuer_name),
    stringField(doc.extracted.registration_number),
    stringField(doc.extracted.delivery_place),
    stringField(doc.extracted.payment_terms),
    stringField(doc.extracted.subtotal),
    stringField(doc.extracted.tax_10),
    stringField(doc.extracted.tax_8),
    stringField(doc.extracted.tax_total),
    formatCsvValue(doc.amountYen),
    stringField(doc.extracted.remarks),
    doc.notes,
    doc.tags.join("|"),
    formatCsvValue(doc.contextDate),
  ];
}

export function buildPurchaseOrderCsvRows(
  documents: PurchaseOrderExportDocument[],
  mode: InvoiceCsvExportMode = "summary"
): string[][] {
  const rows: string[][] = [];

  for (const doc of documents) {
    const headerColumns = buildPurchaseOrderHeaderColumns(doc);

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

export function buildPurchaseOrderCsvRowsWithHeader(
  documents: PurchaseOrderExportDocument[],
  mode: InvoiceCsvExportMode = "summary"
): string[][] {
  return [[...PURCHASE_ORDER_CSV_HEADERS], ...buildPurchaseOrderCsvRows(documents, mode)];
}

export interface ReceiptExportDocument {
  id: string;
  title: string;
  counterparty: string;
  contextDate: string | null;
  amountYen: number | null;
  notes: string;
  tags: string[];
  extracted: Record<string, string>;
}

export type ReceiptExpenseExportDocument = ReceiptExportDocument;
export type ReceiptQualifiedExportDocument = ReceiptExportDocument;

/** CSV 1行目の列名（領収書・社内経費用 13列） */
export const RECEIPT_EXPENSE_CSV_HEADERS = [
  "領収書ID",
  "日付",
  "金額（税込）",
  "支払方法",
  "勘定科目",
  "発行者",
  "利用目的・摘要",
  "参加者",
  "人数",
  "部門/プロジェクトコード",
  "申請者",
  "承認者",
  "メモ",
  "タグ",
] as const;

export function buildReceiptExpenseCsvRows(
  documents: ReceiptExpenseExportDocument[]
): string[][] {
  return documents.map((doc) => [
    doc.id,
    stringField(doc.extracted.transaction_date),
    stringField(doc.extracted.amount),
    stringField(doc.extracted.payment_method),
    stringField(doc.extracted.expense_category),
    stringField(doc.extracted.issuer_name),
    stringField(doc.extracted.purpose),
    stringField(doc.extracted.participants),
    stringField(doc.extracted.participant_count),
    stringField(doc.extracted.department_code),
    stringField(doc.extracted.applicant),
    stringField(doc.extracted.approver),
    doc.notes,
    doc.tags.join("|"),
  ]);
}

export function buildReceiptExpenseCsvRowsWithHeader(
  documents: ReceiptExpenseExportDocument[]
): string[][] {
  return [[...RECEIPT_EXPENSE_CSV_HEADERS], ...buildReceiptExpenseCsvRows(documents)];
}

/** CSV 1行目の列名（領収書・インボイス制度対応用 13列） */
export const RECEIPT_QUALIFIED_CSV_HEADERS = [
  "領収書ID",
  "発行者名",
  "登録番号",
  "取引年月日",
  "取引内容",
  "10%対象合計額",
  "10%消費税額",
  "8%対象合計額",
  "8%消費税額",
  "合計金額",
  "交付を受ける者の氏名",
  "メモ",
  "タグ",
] as const;

export function buildReceiptQualifiedCsvRows(
  documents: ReceiptQualifiedExportDocument[]
): string[][] {
  return documents.map((doc) => [
    doc.id,
    stringField(doc.extracted.issuer_name),
    stringField(doc.extracted.registration_number),
    stringField(doc.extracted.transaction_date),
    stringField(doc.extracted.transaction_details),
    stringField(doc.extracted.subtotal_10),
    stringField(doc.extracted.tax_10),
    stringField(doc.extracted.subtotal_8),
    stringField(doc.extracted.tax_8),
    stringField(doc.extracted.total),
    stringField(doc.extracted.recipient_name),
    doc.notes,
    doc.tags.join("|"),
  ]);
}

export function buildReceiptQualifiedCsvRowsWithHeader(
  documents: ReceiptQualifiedExportDocument[]
): string[][] {
  return [[...RECEIPT_QUALIFIED_CSV_HEADERS], ...buildReceiptQualifiedCsvRows(documents)];
}
