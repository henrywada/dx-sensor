import type { VisionProviderId } from "./types";

/** USD → JPY 換算レート（概算。環境変数 COST_USD_JPY で上書き可） */
export const DEFAULT_USD_JPY = 150;

/**
 * プロバイダ既定単価（USD / 100万トークン）。
 * 公式価格の変動に追随するため、あくまで概算用の定数。
 */
const TOKEN_RATES_USD_PER_M: Record<
  Exclude<VisionProviderId, "plate-recognizer">,
  { input: number; output: number }
> = {
  claude: { input: 3.0, output: 15.0 }, // Claude Sonnet 4.5 相当
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-5": { input: 5.0, output: 15.0 }, // 概算（モデル単価未確定時の仮置き）
  gemini: { input: 0.075, output: 0.3 }, // Gemini 2.5 Flash 相当
};

/** Plate Recognizer Snapshot(+MMC) の1リクエスト概算USD */
const PLATE_RECOGNIZER_FIXED_USD = 0.01;

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export function extractTokenUsage(
  provider: VisionProviderId,
  raw: unknown
): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;

  if (provider === "claude") {
    const usage = data.usage as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    if (!usage) return null;
    return {
      inputTokens: Number(usage.input_tokens) || 0,
      outputTokens: Number(usage.output_tokens) || 0,
    };
  }

  if (provider === "gpt-4o" || provider === "gpt-5") {
    const usage = data.usage as
      | { prompt_tokens?: number; completion_tokens?: number }
      | undefined;
    if (!usage) return null;
    return {
      inputTokens: Number(usage.prompt_tokens) || 0,
      outputTokens: Number(usage.completion_tokens) || 0,
    };
  }

  if (provider === "gemini") {
    const usage = data.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number }
      | undefined;
    if (!usage) return null;
    return {
      inputTokens: Number(usage.promptTokenCount) || 0,
      outputTokens: Number(usage.candidatesTokenCount) || 0,
    };
  }

  return null;
}

export function estimateCostYen(
  provider: VisionProviderId,
  raw: unknown,
  options?: { usdJpy?: number }
): number | null {
  const usdJpy = options?.usdJpy ?? DEFAULT_USD_JPY;

  if (provider === "plate-recognizer") {
    return roundYen(PLATE_RECOGNIZER_FIXED_USD * usdJpy);
  }

  const usage = extractTokenUsage(provider, raw);
  if (!usage) return null;

  const rate = TOKEN_RATES_USD_PER_M[provider];
  const usd =
    (usage.inputTokens * rate.input + usage.outputTokens * rate.output) /
    1_000_000;
  return roundYen(usd * usdJpy);
}

function roundYen(yen: number): number {
  return Math.round(yen * 1000) / 1000;
}

/** UI表示用（例: 0.048円 / 1.2円） */
export function formatCostYen(yen: number): string {
  if (yen < 0.01) return `${yen.toFixed(3)}円`;
  if (yen < 1) return `${yen.toFixed(2)}円`;
  if (yen < 10) return `${yen.toFixed(1)}円`;
  return `${Math.round(yen)}円`;
}
