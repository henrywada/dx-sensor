import type { DocumentTypePlugin, LineItemDraft } from "../../pluginTypes";

export const PURCHASE_ORDER_FIELD_LABELS = {
  order_number: "発注番号",
  issue_date: "発行日",
  delivery_date: "納期",
  recipient_name: "発注先（宛名）",
  issuer_name: "発注元（自社）",
  issuer_address: "発注元住所",
  issuer_phone: "発注元 TEL",
  issuer_email: "発注元メール",
  registration_number: "登録番号",
  delivery_place: "納品場所",
  payment_terms: "支払条件",
  subtotal: "小計（税抜）",
  tax_10: "消費税（10%）",
  tax_8: "消費税（8%）",
  tax_total: "消費税合計",
  total: "合計（税込）",
  remarks: "備考",
} as const;

export const PURCHASE_ORDER_HEADER_KEYS = [
  "order_number",
  "issue_date",
  "delivery_date",
  "recipient_name",
  "issuer_name",
  "issuer_address",
  "issuer_phone",
  "issuer_email",
  "registration_number",
  "delivery_place",
  "payment_terms",
  "subtotal",
  "tax_10",
  "tax_8",
  "tax_total",
  "total",
  "remarks",
] as const;

export type PurchaseOrderHeaderKey = (typeof PURCHASE_ORDER_HEADER_KEYS)[number];

function emptyPurchaseOrderHeader(): Record<PurchaseOrderHeaderKey, string> {
  return Object.fromEntries(
    PURCHASE_ORDER_HEADER_KEYS.map((k) => [k, ""])
  ) as Record<PurchaseOrderHeaderKey, string>;
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

export function normalizeOrderNoRecipient(
  orderNumber: string,
  recipientName: string
): string {
  const normalizedOrder = normalizeWhitespace(orderNumber).toLowerCase();
  const normalizedRecipient = normalizeWhitespace(recipientName).toLowerCase();
  return `${normalizedOrder}|${normalizedRecipient}`;
}

export function parsePurchaseOrderHeader(
  raw: unknown
): Record<PurchaseOrderHeaderKey, string> {
  const result = emptyPurchaseOrderHeader();
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

  for (const key of PURCHASE_ORDER_HEADER_KEYS) {
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

export const purchaseOrderPlugin: DocumentTypePlugin = {
  id: "purchase_order",
  label: "発注書",

  supportsLineItems: true,
  structuredOcr: true,
  parseLineItems,

  imagePolicy: {
    min: 1,
    max: 10,
    allowedRoles: ["page"],
  },

  analyzePrompt: `発注書画像に印刷された文字のみを読み取ってください。推測や補完は禁止です。画像内に明確に存在しない項目は空文字にしてください。JSONのみを返してください。

発注書は「発注元（自社）」が「発注先（取引先）」へ発行する書類です。「御中」「様」が付く宛名側を recipient_name（発注先）として読み取り、社印・住所・連絡先が併記された発行者側を issuer_name（発注元）として読み取ってください。この2つを取り違えないでください。

「発注書」「注文書」「注文請書」いずれの表題でも同じ項目として読み取ってください。発注番号は「発注番号」「注文番号」「伝票番号」「No.」等の表記ゆれがあります。納期は「納期」「希望納期」「納入期日」等、納品場所は「納品場所」「納入場所」「送り先」等、支払条件は「支払条件」「支払方法」「お支払い条件」等の表記ゆれを同一項目として扱ってください。

複数ページがある場合は上から順に読み、明細行は line_no を連番で結合してください。値引き行等のマイナス行も1行として残し、amount にマイナス記号を付けてください。日付は可能なら YYYY-MM-DD 形式にしてください。読めない場合は原文のまま空文字にしてください。

返却形式:
{
  "header": {
    "order_number": "",
    "issue_date": "",
    "delivery_date": "",
    "recipient_name": "",
    "issuer_name": "",
    "issuer_address": "",
    "issuer_phone": "",
    "issuer_email": "",
    "registration_number": "",
    "delivery_place": "",
    "payment_terms": "",
    "subtotal": "",
    "tax_10": "",
    "tax_8": "",
    "tax_total": "",
    "total": "",
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
    return parsePurchaseOrderHeader(raw);
  },

  toIndexedFields(extracted, user) {
    return {
      title: extracted.order_number ?? "",
      counterparty: extracted.recipient_name ?? "",
      context_date: user.contextDate,
      amount_yen: parseAmountYen(extracted.total ?? ""),
    };
  },

  duplicateKeys(extracted) {
    const orderNumber = extracted.order_number ?? "";
    const recipientName = extracted.recipient_name ?? "";
    if (orderNumber.trim() === "" || recipientName.trim() === "") {
      return [];
    }
    return [
      {
        kind: "order_no_recipient",
        value: normalizeOrderNoRecipient(orderNumber, recipientName),
      },
    ];
  },
};
