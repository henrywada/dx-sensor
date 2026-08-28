import type { DocumentTypePlugin, LineItemDraft } from "../../pluginTypes";

export const INVOICE_FIELD_LABELS = {
  invoice_number: "請求番号",
  issue_date: "発行日",
  due_date: "支払期限",
  recipient_name: "請求先（宛名）",
  issuer_name: "請求元（発行者）",
  issuer_address: "請求元住所",
  issuer_phone: "請求元 TEL",
  issuer_email: "請求元メール",
  registration_number: "適格請求書登録番号",
  subtotal: "小計（税抜）",
  tax_10: "消費税（10%）",
  tax_8: "消費税（8%）",
  tax_total: "消費税合計",
  total: "合計（税込）",
  bank_info: "振込先",
  remarks: "備考",
} as const;

export const INVOICE_HEADER_KEYS = [
  "invoice_number",
  "issue_date",
  "due_date",
  "recipient_name",
  "issuer_name",
  "issuer_address",
  "issuer_phone",
  "issuer_email",
  "registration_number",
  "subtotal",
  "tax_10",
  "tax_8",
  "tax_total",
  "total",
  "bank_info",
  "remarks",
] as const;

export type InvoiceHeaderKey = (typeof INVOICE_HEADER_KEYS)[number];

function emptyInvoiceHeader(): Record<InvoiceHeaderKey, string> {
  return Object.fromEntries(INVOICE_HEADER_KEYS.map((k) => [k, ""])) as Record<
    InvoiceHeaderKey,
    string
  >;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeTaxRate(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "※" || trimmed === "*") {
    return "8";
  }
  return trimmed;
}

function normalizeTransactionDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseAmountYen(value: string): number | null {
  const stripped = value
    .trim()
    .replace(/[¥￥]/g, "")
    .replace(/円/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/-$/, "");
  if (stripped === "") {
    return null;
  }
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeInvoiceNoIssuer(
  invoiceNumber: string,
  issuerName: string
): string {
  const normalizedInvoice = normalizeWhitespace(invoiceNumber).toLowerCase();
  const normalizedIssuer = normalizeWhitespace(issuerName).toLowerCase();
  return `${normalizedInvoice}|${normalizedIssuer}`;
}

export function parseInvoiceHeader(raw: unknown): Record<InvoiceHeaderKey, string> {
  const result = emptyInvoiceHeader();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return result;
  }

  const obj = raw as Record<string, unknown>;
  const source =
    typeof obj.header === "object" &&
    obj.header !== null &&
    !Array.isArray(obj.header)
      ? (obj.header as Record<string, unknown>)
      : obj;

  for (const key of INVOICE_HEADER_KEYS) {
    result[key] = stringField(source[key]);
  }
  return result;
}

export function parseLineItems(raw: unknown): LineItemDraft[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((item, index) => {
    const row =
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {};

    const lineNoRaw = row.line_no;
    const lineNo =
      typeof lineNoRaw === "number" && Number.isFinite(lineNoRaw)
        ? lineNoRaw
        : index + 1;

    return {
      line_no: lineNo,
      transaction_date: normalizeTransactionDate(row.transaction_date),
      description: stringField(row.description),
      quantity: stringField(row.quantity),
      unit: stringField(row.unit),
      unit_price: stringField(row.unit_price),
      amount: stringField(row.amount),
      tax_rate: normalizeTaxRate(stringField(row.tax_rate)),
    };
  });
}

export const invoicePlugin: DocumentTypePlugin = {
  id: "invoice",
  label: "請求書",

  supportsLineItems: true,
  structuredOcr: true,
  parseLineItems,

  imagePolicy: {
    min: 1,
    max: 10,
    allowedRoles: ["page"],
  },

  analyzePrompt: `請求書画像に印刷された文字のみを読み取ってください。推測や補完は禁止です。画像内に明確に存在しない項目は空文字にしてください。JSONのみを返してください。

複数ページがある場合は上から順に読み、明細行は line_no を連番で結合してください。出精値引き等のマイナス行も1行として残し、amount にマイナス記号を付けてください。日付は可能なら YYYY-MM-DD 形式にしてください。読めない場合は原文のまま空文字にしてください。

返却形式:
{
  "header": {
    "invoice_number": "",
    "issue_date": "",
    "due_date": "",
    "recipient_name": "",
    "issuer_name": "",
    "issuer_address": "",
    "issuer_phone": "",
    "issuer_email": "",
    "registration_number": "",
    "subtotal": "",
    "tax_10": "",
    "tax_8": "",
    "tax_total": "",
    "total": "",
    "bank_info": "",
    "remarks": ""
  },
  "line_items": [
    {
      "line_no": 1,
      "transaction_date": "",
      "description": "",
      "quantity": "",
      "unit": "",
      "unit_price": "",
      "amount": "",
      "tax_rate": ""
    }
  ]
}`,

  parseExtracted(raw: unknown): Record<string, string> {
    return parseInvoiceHeader(raw);
  },

  toIndexedFields(extracted, user) {
    return {
      title: extracted.invoice_number ?? "",
      counterparty: extracted.issuer_name ?? "",
      context_date: user.contextDate,
      amount_yen: parseAmountYen(extracted.total ?? ""),
    };
  },

  duplicateKeys(extracted) {
    const invoiceNumber = extracted.invoice_number ?? "";
    const issuerName = extracted.issuer_name ?? "";
    if (invoiceNumber.trim() === "" || issuerName.trim() === "") {
      return [];
    }
    return [
      {
        kind: "invoice_no_issuer",
        value: normalizeInvoiceNoIssuer(invoiceNumber, issuerName),
      },
    ];
  },
};
