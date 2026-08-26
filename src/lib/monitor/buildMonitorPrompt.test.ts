import { describe, expect, it } from "vitest";
import { buildMonitorPrompt } from "./buildMonitorPrompt";

describe("buildMonitorPrompt", () => {
  it("includes title and labeled slots", () => {
    const prompt = buildMonitorPrompt({
      title: "駐車場監視",
      labels: ["画像全体説明", "監視ポイント"],
      values: ["駐車場", "空きか駐車中か"],
    });
    expect(prompt).toContain("駐車場監視");
    expect(prompt).toContain("画像全体説明: 駐車場");
    expect(prompt).toContain("監視ポイント: 空きか駐車中か");
    expect(prompt).toContain("2枚の画像");
  });
});
