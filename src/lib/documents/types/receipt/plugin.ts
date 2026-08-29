import type { DocumentMode, DocumentTypePlugin } from "../../pluginTypes";

export const RECEIPT_EXPENSE_FIELD_LABELS = {
  transaction_date: "日付",
  amount: "金額（税込）",
  payment_method: "支払方法",
  expense_category: "勘定科目",
  issuer_name: "発行者・店舗名",
  purpose: "利用目的・摘要",
  participants: "参加者",
  participant_count: "人数",
  department_code: "部門/プロジェクトコード",
  applicant: "申請者",
  approver: "承認者",
} as const;

export const RECEIPT_EXPENSE_HEADER_KEYS = [
  "transaction_date",
  "amount",
  "payment_method",
  "expense_category",
  "issuer_name",
  "purpose",
  "participants",
  "participant_count",
  "department_code",
  "applicant",
  "approver",
] as const;

export type ReceiptExpenseHeaderKey = (typeof RECEIPT_EXPENSE_HEADER_KEYS)[number];

export const RECEIPT_QUALIFIED_FIELD_LABELS = {
  issuer_name: "発行者名",
  registration_number: "登録番号",
  transaction_date: "取引年月日",
  transaction_details: "取引内容",
  subtotal_10: "10%対象合計額",
  tax_10: "10%消費税額",
  subtotal_8: "8%対象合計額",
  tax_8: "8%消費税額",
  total: "合計金額",
  recipient_name: "交付を受ける者の氏名",
} as const;

export const RECEIPT_QUALIFIED_HEADER_KEYS = [
  "issuer_name",
  "registration_number",
  "transaction_date",
  "transaction_details",
  "subtotal_10",
  "tax_10",
  "subtotal_8",
  "tax_8",
  "total",
  "recipient_name",
] as const;

export type ReceiptQualifiedHeaderKey = (typeof RECEIPT_QUALIFIED_HEADER_KEYS)[number];

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
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

function parseHeader<K extends string>(
  raw: unknown,
  keys: readonly K[]
): Record<K, string> {
  const result = Object.fromEntries(keys.map((k) => [k, ""])) as Record<K, string>;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return result;
  }

  const obj = raw as Record<string, unknown>;
  const source =
    typeof obj.header === "object" && obj.header !== null && !Array.isArray(obj.header)
      ? (obj.header as Record<string, unknown>)
      : obj;

  for (const key of keys) {
    result[key] = stringField(source[key]);
  }
  return result;
}

export const receiptExpenseMode: DocumentMode = {
  id: "expense",
  label: "社内経費処理用",

  analyzePrompt: `領収書画像に印刷された文字のみを読み取ってください。推測や補完は禁止です。画像内に明確に存在しない項目は空文字にしてください。JSONのみを返してください。

支払方法は「現金」「カード」「振込」のいずれかで判定できる場合のみ記入し、判定できなければ空文字にしてください。勘定科目は領収書の記載内容から推測できる分類名（交通費・会議費・交際費・消耗品費等）があれば記入し、なければ空文字にしてください。金額は税込の合計金額を記入してください。日付は可能なら YYYY-MM-DD 形式にしてください。

返却形式:
{
  "header": {
    "transaction_date": "",
    "amount": "",
    "payment_method": "",
    "expense_category": "",
    "issuer_name": ""
  }
}`,

  parseExtracted(raw: unknown): Record<string, string> {
    return parseHeader(raw, RECEIPT_EXPENSE_HEADER_KEYS);
  },

  toIndexedFields(extracted, user) {
    return {
      title: extracted.purpose || extracted.issuer_name || "",
      counterparty: extracted.issuer_name ?? "",
      context_date: user.contextDate,
      amount_yen: parseAmountYen(extracted.amount ?? ""),
    };
  },

  duplicateKeys(extracted) {
    const date = extracted.transaction_date ?? "";
    const amount = extracted.amount ?? "";
    const issuer = extracted.issuer_name ?? "";
    if (date.trim() === "" || amount.trim() === "" || issuer.trim() === "") {
      return [];
    }
    return [
      {
        kind: "receipt_expense_key",
        value: `${normalizeWhitespace(date)}|${normalizeWhitespace(amount)}|${normalizeWhitespace(
          issuer
        ).toLowerCase()}`,
      },
    ];
  },
};

export const receiptQualifiedMode: DocumentMode = {
  id: "qualified_invoice",
  label: "インボイス制度対応用（法定記載事項）",

  analyzePrompt: `領収書画像に印刷された文字のみを読み取ってください。推測や補完は禁止です。画像内に明確に存在しない項目は空文字にしてください。JSONのみを返してください。

この領収書は適格請求書等保存方式（インボイス制度）の記載事項確認のために読み取ります。登録番号は「T」で始まる13桁の番号です。取引内容は軽減税率(8%)対象品目がある場合、その旨がわかる表記（※や8%表記等）を含めて記入してください。10%対象と8%対象の合計額・消費税額は、内訳が明記されていればそれぞれ分けて記入し、内訳がない場合は空文字にしてください。交付を受ける者の氏名は宛名として記載があれば記入し、なければ空文字にしてください。日付は可能なら YYYY-MM-DD 形式にしてください。

返却形式:
{
  "header": {
    "issuer_name": "",
    "registration_number": "",
    "transaction_date": "",
    "transaction_details": "",
    "subtotal_10": "",
    "tax_10": "",
    "subtotal_8": "",
    "tax_8": "",
    "total": "",
    "recipient_name": ""
  }
}`,

  parseExtracted(raw: unknown): Record<string, string> {
    return parseHeader(raw, RECEIPT_QUALIFIED_HEADER_KEYS);
  },

  toIndexedFields(extracted, user) {
    return {
      title: extracted.registration_number || extracted.issuer_name || "",
      counterparty: extracted.issuer_name ?? "",
      context_date: user.contextDate,
      amount_yen: parseAmountYen(extracted.total ?? ""),
    };
  },

  duplicateKeys(extracted) {
    const reg = extracted.registration_number ?? "";
    const date = extracted.transaction_date ?? "";
    if (reg.trim() === "" || date.trim() === "") {
      return [];
    }
    return [
      {
        kind: "receipt_qualified_key",
        value: `${normalizeWhitespace(reg).toLowerCase()}|${normalizeWhitespace(date)}`,
      },
    ];
  },
};

export const receiptPlugin: DocumentTypePlugin = {
  id: "receipt",
  label: "領収書",

  imagePolicy: { min: 1, max: 1, allowedRoles: ["page"] },
  structuredOcr: true,
  supportsLineItems: false,
  parseLineItems: () => [],

  modes: [receiptExpenseMode, receiptQualifiedMode],

  // 以下は DocumentTypePlugin の必須フィールドを満たすためのフォールバック。
  // 通常フローは resolveDocumentPlugin() 経由でモード解決済みの plugin を使うため参照されない。
  analyzePrompt: receiptExpenseMode.analyzePrompt,
  parseExtracted: receiptExpenseMode.parseExtracted,
  toIndexedFields: receiptExpenseMode.toIndexedFields,
  duplicateKeys: receiptExpenseMode.duplicateKeys,
};
