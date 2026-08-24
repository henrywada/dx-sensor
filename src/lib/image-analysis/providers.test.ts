import { describe, expect, it } from "vitest";
import { VISION_PROVIDERS, getProviderMeta, isVisionProviderId } from "./providers";

describe("VISION_PROVIDERS", () => {
  it("lists the supported analysis tools in display order", () => {
    expect(VISION_PROVIDERS.map((provider) => provider.id)).toEqual([
      "claude",
      "gpt-4o",
      "gpt-5",
      "gemini",
      "plate-recognizer",
    ]);
  });

  it("requires a prompt for vision models but not for plate recognizer", () => {
    expect(getProviderMeta("claude")?.requiresPrompt).toBe(true);
    expect(getProviderMeta("gpt-4o")?.requiresPrompt).toBe(true);
    expect(getProviderMeta("gpt-5")?.requiresPrompt).toBe(true);
    expect(getProviderMeta("gemini")?.requiresPrompt).toBe(true);
    expect(getProviderMeta("plate-recognizer")?.requiresPrompt).toBe(false);
  });

  it("rejects unknown provider ids", () => {
    expect(isVisionProviderId("aws-rekognition")).toBe(false);
    expect(getProviderMeta("aws-rekognition")).toBeNull();
  });
});
