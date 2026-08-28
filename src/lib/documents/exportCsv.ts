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

export function buildInvoiceCsvRows(
  documents: InvoiceExportDocument[]
): string[][] {
  const rows: string[][] = [];

  for (const doc of documents) {
    const headerColumns = [
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

    const sortedLineItems = [...doc.lineItems].sort(
      (a, b) => a.line_no - b.line_no
    );

    if (sortedLineItems.length === 0) {
      rows.push([
        ...headerColumns,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
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

export function encodeCsvWithBom(rows: string[][]): Buffer {
  const body = rows.map(encodeCsvRow).join("\n");
  return Buffer.from("\uFEFF" + body, "utf-8");
}
