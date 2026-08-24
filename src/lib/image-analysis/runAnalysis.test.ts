import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalysisError, runAnalysis } from "./runAnalysis";

const jpeg = Buffer.from("fake-image");

describe("runAnalysis", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects a blank prompt for vision models", async () => {
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
    await expect(
      runAnalysis("unknown" as never, {
        imageBuffer: jpeg,
        mimeType: "image/jpeg",
        prompt: "test",
      })
    ).rejects.toBeInstanceOf(AnalysisError);
  });
});
