import type { DocumentTypePlugin } from "../../pluginTypes";

export const CARD_KEYS = [
  "full_name",
  "company",
  "title",
  "department",
  "address",
  "phone",
  "fax",
  "email",
  "website",
] as const;

export type CardKey = (typeof CARD_KEYS)[number];

function emptyCard(): Record<CardKey, string> {
  return Object.fromEntries(CARD_KEYS.map((k) => [k, ""])) as Record<
    CardKey,
    string
  >;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeNameCompany(name: string, company: string): string {
  const normalizedName = normalizeWhitespace(name).toLowerCase();
  const normalizedCompany = normalizeWhitespace(company).toLowerCase();
  return `${normalizedName}|${normalizedCompany}`;
}

export function mergeExtracted(
  front: Record<string, string>,
  back: Record<string, string>
): Record<string, string> {
  const merged = emptyCard();
  for (const key of CARD_KEYS) {
    const frontValue = front[key]?.trim() ?? "";
    const backValue = back[key]?.trim() ?? "";
    merged[key] = frontValue !== "" ? frontValue : backValue;
  }
  return merged;
}

export const businessCardPlugin: DocumentTypePlugin = {
  id: "business_card",
  label: "名刺",

  imagePolicy: {
    min: 1,
    max: 2,
    allowedRoles: ["front", "back"],
  },

  analyzePrompt: `名刺画像に印刷された連絡先情報のみを読み取ってください。推測や補完は禁止です。画像内に明確に存在しない項目は空文字にしてください。JSONのみを返してください。

画像が1枚の場合: { "front": { "full_name": "", "company": "", "title": "", "department": "", "address": "", "phone": "", "fax": "", "email": "", "website": "" } }

画像が2枚の場合: 1枚目は表面、2枚目は裏面です。"front" と "back" の下に同じキーを置いてください: { "front": { ... }, "back": { ... } }`,

  parseExtracted(raw: unknown): Record<string, string> {
    const result = emptyCard();
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return result;
    }
    const obj = raw as Record<string, unknown>;
    for (const key of CARD_KEYS) {
      const value = obj[key];
      result[key] = typeof value === "string" ? value : "";
    }
    return result;
  },

  toIndexedFields(extracted, user) {
    return {
      title: extracted.full_name ?? "",
      counterparty: extracted.company ?? "",
      context_date: user.contextDate,
      amount_yen: null,
    };
  },

  duplicateKeys(extracted) {
    const keys: { kind: string; value: string }[] = [];

    const email = normalizeEmail(extracted.email ?? "");
    if (email !== "") {
      keys.push({ kind: "email", value: email });
    }

    const name = extracted.full_name ?? "";
    const company = extracted.company ?? "";
    if (name.trim() !== "" && company.trim() !== "") {
      keys.push({
        kind: "name_company",
        value: normalizeNameCompany(name, company),
      });
    }

    return keys;
  },
};
