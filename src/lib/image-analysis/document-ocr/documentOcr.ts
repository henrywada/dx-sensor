import type {
  DocumentTypePlugin,
  LineItemDraft,
} from "@/lib/documents/pluginTypes";
import type { FetchImpl } from "../types";
import { parseVisionJson } from "./parseVisionJson";

type GeminiContentPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

export interface DocumentOcrImage {
  imageBuffer: Buffer;
  mimeType: string;
}

export interface DocumentOcrInput {
  front?: DocumentOcrImage;
  back?: DocumentOcrImage;
  pages?: DocumentOcrImage[];
  plugin: DocumentTypePlugin;
  apiKey: string;
  model?: string;
  fetchImpl?: FetchImpl;
}

export interface DocumentOcrResult {
  extracted: Record<string, string>;
  lineItems?: LineItemDraft[];
  rawText: string;
  raw: unknown;
}

function imagePart(image: DocumentOcrImage): GeminiContentPart {
  return {
    inline_data: {
      mime_type: image.mimeType,
      data: image.imageBuffer.toString("base64"),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeExtracted(
  front: Record<string, string>,
  back: Record<string, string>
): Record<string, string> {
  const keys = new Set([...Object.keys(front), ...Object.keys(back)]);
  const merged: Record<string, string> = {};

  for (const key of keys) {
    const frontValue = front[key]?.trim() ?? "";
    const backValue = back[key]?.trim() ?? "";
    merged[key] = frontValue !== "" ? frontValue : backValue;
  }

  return merged;
}

function collectStructuredPages(input: DocumentOcrInput): DocumentOcrImage[] {
  if (input.pages && input.pages.length > 0) {
    return input.pages;
  }
  if (input.front) {
    return input.back ? [input.front, input.back] : [input.front];
  }
  return [];
}

export async function ocrDocument(
  input: DocumentOcrInput
): Promise<DocumentOcrResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const model = input.model ?? "gemini-2.5-flash";
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(input.apiKey)}`;
  const parts: GeminiContentPart[] = [{ text: input.plugin.analyzePrompt }];

  if (input.plugin.structuredOcr) {
    const pages = collectStructuredPages(input);
    if (pages.length === 0) {
      throw new Error("At least one page image is required");
    }
    for (const page of pages) {
      parts.push(imagePart(page));
    }
  } else {
    if (!input.front) {
      throw new Error("Front image is required");
    }
    parts.push(imagePart(input.front));
    if (input.back) {
      parts.push(imagePart(input.back));
    }
  }

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
    }),
  });

  if (!res.ok) {
    const detail = (await res.text?.()) ?? res.statusText;
    throw new Error(`Gemini API error: ${res.status} ${detail}`.trim());
  }

  const raw = (await res.json()) as GeminiResponse;
  const rawText = (raw.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!rawText) throw new Error("Gemini API returned an empty response");

  const parsed = parseVisionJson(rawText);
  if (parsed === null) {
    throw new Error("Gemini OCR response was not valid JSON");
  }

  if (input.plugin.structuredOcr) {
    const parsedRecord = isRecord(parsed) ? parsed : {};
    const extracted = input.plugin.parseExtracted(parsedRecord.header);
    const lineItems = input.plugin.parseLineItems!(parsedRecord.line_items);

    return {
      extracted,
      lineItems,
      rawText,
      raw,
    };
  }

  const parsedRecord = isRecord(parsed) ? parsed : {};
  const hasSides = "front" in parsedRecord || "back" in parsedRecord;
  const frontRaw = hasSides ? parsedRecord.front : parsed;
  const backRaw = hasSides ? parsedRecord.back : {};
  const frontExtracted = input.plugin.parseExtracted(frontRaw);
  const backExtracted = input.plugin.parseExtracted(backRaw);

  return {
    extracted: mergeExtracted(frontExtracted, backExtracted),
    rawText,
    raw,
  };
}
