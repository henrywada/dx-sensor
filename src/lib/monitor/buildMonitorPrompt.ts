export type BuildMonitorPromptInput = {
  title: string;
  labels: string[];
  values: string[];
};

const COMPARE_INSTRUCTION =
  "前画像と後画像の2枚の画像を比較し、監視ポイント／メール通知ポイントに沿って変化を日本語で簡潔に述べよ。";

export function buildMonitorPrompt(input: BuildMonitorPromptInput): string {
  const { title, labels, values } = input;
  const lines: string[] = [title];

  for (let i = 0; i < labels.length; i++) {
    const value = values[i] ?? "";
    if (value.trim() === "") continue;
    lines.push(`${labels[i]}: ${value}`);
  }

  lines.push(COMPARE_INSTRUCTION);
  return lines.join("\n");
}
