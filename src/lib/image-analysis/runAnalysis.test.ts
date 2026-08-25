import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { AnalysisError, runAnalysis } from "./runAnalysis";

async function makeJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 10, g: 20, b: 30 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe("runAnalysis", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects a blank prompt for vision models", async () => {
    const jpeg = await makeJpeg();
    await expect(
      runAnalysis("claude", {
        imageBuffer: jpeg,
        mimeType: "image/jpeg",
        prompt: "   ",
      })
    ).rejects.toEqual(expect.objectContaining({
      message: expect.stringContaining("命令"),
      statusCode: 400,
    }));
  });

  it("throws when the provider API key is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const jpeg = await makeJpeg();

    await expect(
      runAnalysis("claude", {
        imageBuffer: jpeg,
        mimeType: "image/jpeg",
        prompt: "何が写っていますか",
      })
    ).rejects.toEqual(expect.objectContaining({
      message: expect.stringContaining("APIキー"),
      statusCode: 503,
    }));
  });

  it("formats a plate-recognizer response without requiring a prompt", async () => {
    vi.stubEnv("PLATE_RECOGNIZER_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              plate: "abc123",
              score: 0.91,
              vehicle: { color: [{ name: "white" }] },
              model_make: "Toyota Prius",
            },
          ],
        }),
      })
    );

    const jpeg = await makeJpeg();
    const result = await runAnalysis("plate-recognizer", {
      imageBuffer: jpeg,
      mimeType: "image/jpeg",
      prompt: "",
    });

    expect(result.text).toContain("abc123");
    expect(result.text).toContain("white");
    expect(result.text).toContain("Toyota Prius");
  });

  it("wraps unknown providers as a 400 error", async () => {
    const jpeg = await makeJpeg();
    await expect(
      runAnalysis("unknown" as never, {
        imageBuffer: jpeg,
        mimeType: "image/jpeg",
        prompt: "test",
      })
    ).rejects.toBeInstanceOf(AnalysisError);
  });
});
