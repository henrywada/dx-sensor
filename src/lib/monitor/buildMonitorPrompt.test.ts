import { describe, expect, it } from "vitest";
import { buildMonitorPrompt, MONITOR_RESPONSE_SCHEMA } from "./buildMonitorPrompt";

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

  it("instructs Gemini to judge severity and return structured JSON", () => {
    const prompt = buildMonitorPrompt({
      title: "駐車場監視",
      labels: [],
      values: [],
    });
    expect(prompt).toContain("severity");
    expect(prompt).toContain("notify");
    expect(prompt).toContain("minor");
  });

  it("exports a Gemini responseSchema requiring severity and summary", () => {
    expect(MONITOR_RESPONSE_SCHEMA.required).toEqual(["severity", "summary"]);
    expect(MONITOR_RESPONSE_SCHEMA.properties.severity.enum).toEqual([
      "notify",
      "minor",
    ]);
  });

  it("converts an output-format slot into a summary-shaping instruction instead of a regular slot line", () => {
    const prompt = buildMonitorPrompt({
      title: "駐車場監視",
      labels: ["監視ポイント", "出力フォーマット"],
      values: ["空きか駐車中か", "駐車台数（○台）、空き駐車スポット（○台）です。"],
    });
    expect(prompt).toContain("監視ポイント: 空きか駐車中か");
    expect(prompt).not.toContain("出力フォーマット: 駐車台数");
    expect(prompt).toContain("文型");
    expect(prompt).toContain("駐車台数（○台）、空き駐車スポット（○台）です。");
    expect(prompt).toContain("日時");
  });

  it("falls back to free-form summary instructions when the output-format slot is empty", () => {
    const prompt = buildMonitorPrompt({
      title: "駐車場監視",
      labels: ["監視ポイント", "出力フォーマット"],
      values: ["空きか駐車中か", ""],
    });
    expect(prompt).not.toContain("文型");
  });

  it("instructs Gemini to read the current-image state first, then append the comparison-based change description", () => {
    const prompt = buildMonitorPrompt({
      title: "駐車場監視",
      labels: ["出力フォーマット"],
      values: ["駐車台数（○台）、空き駐車スポット（○台）です。"],
    });
    expect(prompt).toContain("後画像（今回の写真）");
    expect(prompt).toContain("先頭");
    expect(prompt).toContain("追記");
    expect(prompt).toContain("変化");
  });
});
