import type { FetchImpl, VisionAnalyzeInput, VisionAnalyzeResult } from "../types";

type GeminiAnalyzeInput = VisionAnalyzeInput & {
  previousImageBuffer?: Buffer;
  previousMimeType?: string;
};

export async function analyzeWithGemini(
  input: GeminiAnalyzeInput,
  options: {
    apiKey: string;
    model?: string;
    fetchImpl?: FetchImpl;
    /** 指定時は generationConfig.responseSchema としてJSON構造化出力を強制する。 */
    responseSchema?: object;
  }
): Promise<VisionAnalyzeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "gemini-2.5-flash";
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(options.apiKey)}`;

  type ContentPart =
    | { text: string }
    | { inline_data: { mime_type: string; data: string } };

  const parts: ContentPart[] = [{ text: input.prompt }];

  if (input.previousImageBuffer) {
    parts.push({
      inline_data: {
        mime_type: input.previousMimeType ?? input.mimeType,
        data: input.previousImageBuffer.toString("base64"),
      },
    });
  }

  parts.push({
    inline_data: {
      mime_type: input.mimeType,
      data: input.imageBuffer.toString("base64"),
    },
  });

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      ...(options.responseSchema
        ? {
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: options.responseSchema,
            },
          }
        : {}),
    }),
  });

  if (!res.ok) {
    const detail = (await res.text?.()) ?? res.statusText;
    throw new Error(`Gemini API error: ${res.status} ${detail}`.trim());
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) throw new Error("Gemini API returned an empty response");
  return { text, raw: data, model };
}
