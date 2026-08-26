import { describe, expect, it } from "vitest";
import { classifyDiffScore } from "./thresholds";

describe("classifyDiffScore", () => {
  it("classifies skip / minor / notify", () => {
    expect(classifyDiffScore(0)).toBe("skip");
    expect(classifyDiffScore(0.019)).toBe("skip");
    expect(classifyDiffScore(0.02)).toBe("minor");
    expect(classifyDiffScore(0.079)).toBe("minor");
    expect(classifyDiffScore(0.08)).toBe("notify");
  });
});
