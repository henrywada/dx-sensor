import type { AnprResult } from "./plateRecognizer";

export function formatAnprResult(result: AnprResult): string {
  if (!result.plateNumber) {
    return "ナンバープレートは検出されませんでした。";
  }

  const lines = [`ナンバー: ${result.plateNumber}`];
  if (result.confidence != null) lines.push(`信頼度: ${result.confidence}`);
  if (result.vehicleColor) lines.push(`車色: ${result.vehicleColor}`);
  if (result.vehicleMakeModel) lines.push(`車種: ${result.vehicleMakeModel}`);
  return lines.join("\n");
}
