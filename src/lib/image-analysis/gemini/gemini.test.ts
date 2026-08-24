import { describe, expect, it, vi } from "vitest";
import { analyzeWithGemini } from "./gemini";

describe("analyzeWithGemini", () => {
  it("posts the image and prompt to the Gemini generateContent API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "通路が混雑しています。" }],
            },
          },
        ],
      }),
    });

    const result = await analyzeWithGemini(
      {
        imageBuffer: Buffer.from("hello"),
        mimeType: "image/jpeg",
        prompt: "混雑度を教えて",
      },
      { apiKey: "gemini-test", model: "gemini-2.5-flash", fetchImpl: fetchMock }
    );

    expect(result.text).toBe("通路が混雑しています。");
    expect(fetchMock.mock.calls[0][0]).toContain(
      "generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(fetchMock.mock.calls[0][0]).toContain("key=gemini-test");
  });
});
