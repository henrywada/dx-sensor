export type ImageRole = "front" | "back" | "page";

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
}
