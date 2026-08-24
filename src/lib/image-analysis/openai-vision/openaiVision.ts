import type { FetchImpl, VisionAnalyzeInput, VisionAnalyzeResult } from "../types";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

export async function analyzeWithOpenAI(
  input: VisionAnalyzeInput,
  options: { apiKey: string; model: string; fetchImpl?: FetchImpl }
): Promise<VisionAnalyzeResult> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const res = await fetchImpl(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${input.mimeType};base64,${input.imageBuffer.toString("base64")}`,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = (await res.text?.()) ?? res.statusText;
    throw new Error(`OpenAI Vision API error: ${res.status} ${detail}`.trim());
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  const text = extractOpenAIText(content).trim();

  if (!text) throw new Error("OpenAI Vision API returned an empty response");
  return { text, raw: data };
}

function extractOpenAIText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } =>
      Boolean(part && typeof part === "object" && (part as { type?: string }).type === "text")
    )
    .map((part) => part.text)
    .join("\n");
}
