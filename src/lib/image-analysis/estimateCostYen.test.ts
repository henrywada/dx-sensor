import { describe, expect, it } from "vitest";
import {
  estimateCostYen,
  extractTokenUsage,
  formatCostYen,
} from "./estimateCostYen";

describe("extractTokenUsage", () => {
  it("reads Claude usage", () => {
    expect(
      extractTokenUsage("claude", {
        usage: { input_tokens: 1200, output_tokens: 80 },
      })
    ).toEqual({ inputTokens: 1200, outputTokens: 80 });
  });

  it("reads OpenAI usage", () => {
    expect(
      extractTokenUsage("gpt-4o", {
        usage: { prompt_tokens: 900, completion_tokens: 50 },
      })
    ).toEqual({ inputTokens: 900, outputTokens: 50 });
  });

  it("reads Gemini usageMetadata", () => {
    expect(
      extractTokenUsage("gemini", {
        usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 100 },
      })
    ).toEqual({ inputTokens: 2000, outputTokens: 100 });
  });
});

describe("estimateCostYen", () => {
  it("estimates Claude cost in yen at the default FX rate", () => {
    // (1200*3 + 80*15) / 1e6 * 150 = 0.72円
    const yen = estimateCostYen("claude", {
      usage: { input_tokens: 1200, output_tokens: 80 },
    });
    expect(yen).toBe(0.72);
  });

  it("uses a fixed per-call estimate for plate-recognizer", () => {
    // 0.01 USD * 150 = 1.5円
    expect(estimateCostYen("plate-recognizer", {})).toBe(1.5);
  });

  it("returns null when token usage is missing", () => {
    expect(estimateCostYen("gemini", { candidates: [] })).toBeNull();
  });
});

describe("formatCostYen", () => {
  it("formats small and large amounts", () => {
    expect(formatCostYen(0.004)).toBe("0.004円");
    expect(formatCostYen(0.48)).toBe("0.48円");
    expect(formatCostYen(1.25)).toBe("1.3円");
    expect(formatCostYen(12.4)).toBe("12円");
  });
});
