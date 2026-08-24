import { describe, expect, it } from "vitest";
import { parseAnalyzeRequest } from "./parseAnalyzeRequest";

describe("parseAnalyzeRequest", () => {
  it("accepts a valid analysis request", () => {
    expect(
      parseAnalyzeRequest({
        captureId: "11111111-1111-4111-8111-111111111111",
        provider: "gemini",
        prompt: "人数を数えてください",
      })
    ).toEqual({
      captureId: "11111111-1111-4111-8111-111111111111",
      provider: "gemini",
      prompt: "人数を数えてください",
    });
  });

  it("defaults a missing prompt to an empty string", () => {
    const parsed = parseAnalyzeRequest({
      captureId: "11111111-1111-4111-8111-111111111111",
      provider: "plate-recognizer",
    });
    expect(parsed.prompt).toBe("");
  });

  it("rejects an invalid capture id or provider", () => {
    expect(() =>
      parseAnalyzeRequest({ captureId: "not-a-uuid", provider: "claude", prompt: "x" })
    ).toThrow();
    expect(() =>
      parseAnalyzeRequest({
        captureId: "11111111-1111-4111-8111-111111111111",
        provider: "aws-rekognition",
        prompt: "x",
      })
    ).toThrow();
  });
});
