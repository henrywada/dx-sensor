import type { FetchImpl, VisionAnalyzeInput, VisionAnalyzeResult } from "../types";

export async function analyzeWithGemini(
  input: VisionAnalyzeInput,
  options: { apiKey: string; model?: string; fetchImpl?: FetchImpl }
): Promise<VisionAnalyzeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "gemini-2.5-flash";
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${encodeURIComponent(options.apiKey)}`;

  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: input.prompt },
            {
              inline_data: {
                mime_type: input.mimeType,
                data: input.imageBuffer.toString("base64"),
              },
            },
          ],
        },
      ],
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
  return { text, raw: data };
}
