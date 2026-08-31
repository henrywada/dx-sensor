export type BuildMonitorPromptInput = {
  title: string;
  labels: string[];
  values: string[];
};

const COMPARE_INSTRUCTION =
  "前画像と後画像の2枚の画像を比較し、監視ポイント／メール通知ポイントに沿って変化を日本語で簡潔に述べよ。" +
  "さらに、その変化が通知に値する重要な変化か、無視してよい軽微な変化かを判定せよ。" +
  '出力はJSON以外の文字を含めず、{"severity": "notify" または "minor", "summary": "変化の説明"} の形式のみで返せ。';

/** GeminiのgenerationConfig.responseSchemaに渡す、監視tick用の構造化出力スキーマ。 */
export const MONITOR_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    severity: { type: "STRING", enum: ["notify", "minor"] },
    summary: { type: "STRING" },
  },
  required: ["severity", "summary"],
} as const;

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
