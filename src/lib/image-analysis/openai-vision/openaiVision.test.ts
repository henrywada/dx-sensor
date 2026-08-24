import { describe, expect, it, vi } from "vitest";
import { analyzeWithOpenAI } from "./openaiVision";

describe("analyzeWithOpenAI", () => {
  it("posts the image and prompt to OpenAI Chat Completions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "棚に商品が並んでいます。" } }],
      }),
    });

    const result = await analyzeWithOpenAI(
      {
        imageBuffer: Buffer.from("hello"),
        mimeType: "image/png",
        prompt: "陳列状態を説明して",
      },
      { apiKey: "sk-test", model: "gpt-4o", fetchImpl: fetchMock }
    );

    expect(result.text).toBe("棚に商品が並んでいます。");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-4o");
    expect(body.messages[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "陳列状態を説明して" }),
        expect.objectContaining({ type: "image_url" }),
      ])
    );
  });
});
