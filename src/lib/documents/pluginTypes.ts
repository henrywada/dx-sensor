export type ImageRole = "front" | "back" | "page";

export interface LineItemDraft {
  line_no: number;
  transaction_date: string | null;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  amount: string;
  tax_rate: string;
}

export interface DocumentTypePlugin {
  id: string;
  label: string;
  imagePolicy: { min: number; max: number; allowedRoles: ImageRole[] };
  analyzePrompt: string;
  parseExtracted(raw: unknown): Record<string, string>;
  toIndexedFields(
    extracted: Record<string, string>,
    user: {
      notes: string;
      tags: string[];
      contextDate: string | null;
    }
  ): {
    title: string;
    counterparty: string;
    context_date: string | null;
    amount_yen: number | null;
  };
  duplicateKeys(
    extracted: Record<string, string>
  ): { kind: string; value: string }[];
  /** 明細を持つ種類のみ。未指定なら lineItems 非対応 */
  supportsLineItems?: boolean;
  /** analyzePrompt が返す JSON 形の説明（Gemini 用。invoice は structured） */
  structuredOcr?: boolean;
  parseLineItems?(raw: unknown): LineItemDraft[];
}
