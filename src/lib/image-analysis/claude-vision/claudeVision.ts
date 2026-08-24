import type { FetchImpl, VisionAnalyzeInput, VisionAnalyzeResult } from "../types";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export async function analyzeWithClaude(
  input: VisionAnalyzeInput,
  options: { apiKey: string; model?: string; fetchImpl?: FetchImpl }
): Promise<VisionAnalyzeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "claude-sonnet-4-5";

  const res = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": options.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mimeType,
                data: input.imageBuffer.toString("base64"),
              },
            },
            { type: "text", text: input.prompt },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = (await res.text?.()) ?? res.statusText;
    throw new Error(`Claude Vision API error: ${res.status} ${detail}`.trim());
  }

  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (data.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Claude Vision API returned an empty response");
  return { text, raw: data };
}
