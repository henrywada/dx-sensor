import type { LineItemDraft } from "./pluginTypes";

export interface DbLineItemRow {
  document_id: string;
  tenant_id: string;
  line_no: number;
  transaction_date: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: number | null;
  amount: number | null;
  tax_rate: string;
}

export function parseNumericOrNull(value: string): number | null {
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

function normalizeTaxRate(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "※" || trimmed === "*") {
    return "8";
  }
  return trimmed;
}

export function normalizeLineItemDraft(draft: LineItemDraft): LineItemDraft {
  const transactionDate = draft.transaction_date?.trim() ?? "";
  return {
    line_no: draft.line_no,
    transaction_date: transactionDate === "" ? null : transactionDate,
    description: draft.description.trim(),
    quantity: draft.quantity.trim(),
    unit: draft.unit.trim(),
    unit_price: draft.unit_price.trim(),
    amount: draft.amount.trim(),
    tax_rate: normalizeTaxRate(draft.tax_rate),
  };
}

function parseTransactionDate(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return trimmed;
  }

  const slashMatch = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const [, year, month, day] = slashMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}

export function lineItemDraftToDbRow(
  draft: LineItemDraft,
  documentId: string,
  tenantId: string
): DbLineItemRow {
  const normalized = normalizeLineItemDraft(draft);
  return {
    document_id: documentId,
    tenant_id: tenantId,
    line_no: normalized.line_no,
    transaction_date: parseTransactionDate(normalized.transaction_date),
    description: normalized.description,
    quantity: normalized.quantity,
    unit: normalized.unit,
    unit_price: parseNumericOrNull(normalized.unit_price),
    amount: parseNumericOrNull(normalized.amount),
    tax_rate: normalized.tax_rate,
  };
}
