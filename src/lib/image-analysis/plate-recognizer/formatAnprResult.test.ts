import { describe, expect, it } from "vitest";
import { formatAnprResult } from "./formatAnprResult";

describe("formatAnprResult", () => {
  it("returns a readable summary when a plate is found", () => {
    const text = formatAnprResult({
      plateNumber: "品川300あ12-34",
      confidence: 0.88,
      vehicleColor: "black",
      vehicleMakeModel: "Honda Fit",
      raw: {},
    });

    expect(text).toBe(
      ["ナンバー: 品川300あ12-34", "信頼度: 0.88", "車色: black", "車種: Honda Fit"].join("\n")
    );
  });

  it("says no plate was found when the detector returns empty", () => {
    const text = formatAnprResult({
      plateNumber: null,
      confidence: null,
      vehicleColor: null,
      vehicleMakeModel: null,
      raw: {},
    });

    expect(text).toBe("ナンバープレートは検出されませんでした。");
  });
});
