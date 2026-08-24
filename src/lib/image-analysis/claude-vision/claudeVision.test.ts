import { describe, expect, it, vi } from "vitest";
import { analyzeWithClaude } from "./claudeVision";

describe("analyzeWithClaude", () => {
  it("posts the image and prompt to the Anthropic Messages API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "駐車場に車が2台あります。" }],
      }),
    });

    const result = await analyzeWithClaude(
      {
        imageBuffer: Buffer.from("hello"),
        mimeType: "image/jpeg",
        prompt: "何が写っていますか",
      },
      { apiKey: "sk-ant-test", fetchImpl: fetchMock }
    );

    expect(result.text).toBe("駐車場に車が2台あります。");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-api-key": "sk-ant-test",
          "anthropic-version": "2023-06-01",
        }),
      })
    );
  });

  it("throws when Anthropic returns an error status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "invalid api key",
    });

    await expect(
      analyzeWithClaude(
        { imageBuffer: Buffer.from("hello"), mimeType: "image/jpeg", prompt: "x" },
        { apiKey: "bad", fetchImpl: fetchMock }
      )
    ).rejects.toThrow(/Claude/);
  });
});
