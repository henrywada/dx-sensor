export type BuildMonitorPromptInput = {
  title: string;
  labels: string[];
  values: string[];
};

const COMPARE_INSTRUCTION =
  "前画像と後画像の2枚の画像を比較し、監視ポイント／メール通知ポイントに沿って変化を日本語で簡潔に述べよ。" +
  "さらに、その変化が通知に値する重要な変化か、無視してよい軽微な変化かを判定せよ。" +
  '出力はJSON以外の文字を含めず、{"severity": "notify" または "minor", "summary": "変化の説明"} の形式のみで返せ。';

/** この項目名の値は通常の監視条件ではなく、summaryの出力形式サンプルとして扱う。 */
const OUTPUT_FORMAT_LABEL = "出力フォーマット";

function buildOutputFormatInstruction(outputFormat: string): string {
  return (
    "summaryは次の文型に厳密に従い、実際の観測値だけを当てはめて生成せよ。" +
    "日時・時刻は書かない（システム側で別途付与するため）。当てはまらない項目は文型から省いてよい。" +
    `文型: ${outputFormat}`
  );
}

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
  let outputFormat = "";

  for (let i = 0; i < labels.length; i++) {
    const value = values[i] ?? "";
    if (value.trim() === "") continue;
    if (labels[i]?.trim() === OUTPUT_FORMAT_LABEL) {
      outputFormat = value.trim();
      continue;
    }
    lines.push(`${labels[i]}: ${value}`);
  }

  if (outputFormat) {
    lines.push(buildOutputFormatInstruction(outputFormat));
  }

  lines.push(COMPARE_INSTRUCTION);
  return lines.join("\n");
}
