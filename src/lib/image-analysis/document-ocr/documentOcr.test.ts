import { describe, expect, it, vi } from "vitest";
import { businessCardPlugin } from "@/lib/documents/types/business_card/plugin";
import { ocrDocument } from "./documentOcr";

describe("ocrDocument", () => {
  it("posts prompt, front, then back to Gemini and returns merged extracted fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    front: {
                      full_name: "山田太郎",
                      company: "",
                      title: "",
                      department: "",
                      address: "",
                      phone: "",
                      fax: "",
                      email: "",
                      website: "",
                    },
                    back: {
                      full_name: "Yamada Taro",
                      company: "例示商事",
                      title: "",
                      department: "",
                      address: "",
                      phone: "",
                      fax: "",
                      email: "taro@example.com",
                      website: "",
                    },
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await ocrDocument({
      front: { imageBuffer: Buffer.from("front"), mimeType: "image/jpeg" },
      back: { imageBuffer: Buffer.from("back"), mimeType: "image/png" },
      plugin: businessCardPlugin,
      apiKey: "gemini-test",
      model: "gemini-2.5-flash",
      fetchImpl: fetchMock,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const parts = body.contents[0].parts;

    expect(fetchMock.mock.calls[0][0]).toContain(
      "generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ text: businessCardPlugin.analyzePrompt });
    expect(parts[1]).toEqual({
      inline_data: {
        mime_type: "image/jpeg",
        data: Buffer.from("front").toString("base64"),
      },
    });
    expect(parts[2]).toEqual({
      inline_data: {
        mime_type: "image/png",
        data: Buffer.from("back").toString("base64"),
      },
    });
    expect(result.extracted.full_name).toBe("山田太郎");
    expect(result.extracted.company).toBe("例示商事");
    expect(result.extracted.email).toBe("taro@example.com");
    expect(result.rawText).toContain("front");
    expect(result.raw).toHaveProperty("candidates");
  });

  it("sends only the front image and treats a top-level object as front", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    full_name: "佐藤花子",
                    company: "サンプル株式会社",
                    email: "hanako@example.com",
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await ocrDocument({
      front: { imageBuffer: Buffer.from("front-only"), mimeType: "image/webp" },
      plugin: businessCardPlugin,
      apiKey: "gemini-test",
      fetchImpl: fetchMock,
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const parts = body.contents[0].parts;

    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({
      inline_data: {
        mime_type: "image/webp",
        data: Buffer.from("front-only").toString("base64"),
      },
    });
    expect(result.extracted.full_name).toBe("佐藤花子");
    expect(result.extracted.company).toBe("サンプル株式会社");
    expect(result.extracted.email).toBe("hanako@example.com");
  });

  it("throws when Gemini returns invalid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "読み取り失敗" }] } }],
      }),
    });

    await expect(
      ocrDocument({
        front: { imageBuffer: Buffer.from("front"), mimeType: "image/jpeg" },
        plugin: businessCardPlugin,
        apiKey: "gemini-test",
        fetchImpl: fetchMock,
      })
    ).rejects.toThrow("Gemini OCR response was not valid JSON");
  });
});
