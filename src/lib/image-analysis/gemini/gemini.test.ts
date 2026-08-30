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
    expect(result.model).toBe("gemini-2.5-flash");
    expect(fetchMock.mock.calls[0][0]).toContain(
      "generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(fetchMock.mock.calls[0][0]).toContain("key=gemini-test");
  });

  it("includes previous and current inline_data when previousImageBuffer is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: "変化を検出しました。" }],
            },
          },
        ],
      }),
    });

    await analyzeWithGemini(
      {
        imageBuffer: Buffer.from("current"),
        mimeType: "image/jpeg",
        prompt: "2枚の差分を教えて",
        previousImageBuffer: Buffer.from("previous"),
        previousMimeType: "image/png",
      },
      { apiKey: "gemini-test", fetchImpl: fetchMock }
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const parts = body.contents[0].parts;

    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ text: "2枚の差分を教えて" });
    expect(parts[1]).toEqual({
      inline_data: {
        mime_type: "image/png",
        data: Buffer.from("previous").toString("base64"),
      },
    });
    expect(parts[2]).toEqual({
      inline_data: {
        mime_type: "image/jpeg",
        data: Buffer.from("current").toString("base64"),
      },
    });
  });
});
