import { analyzeWithClaude } from "./claude-vision/claudeVision";
import { estimateCostYen } from "./estimateCostYen";
import { analyzeWithGemini } from "./gemini/gemini";
import { analyzeWithOpenAI } from "./openai-vision/openaiVision";
import { formatAnprResult } from "./plate-recognizer/formatAnprResult";
import { recognizePlate } from "./plate-recognizer/plateRecognizer";
import { prepareVisionImage, resolveMaxEdgePx } from "./prepareVisionImage";
import { getProviderMeta, isVisionProviderId } from "./providers";
import type { VisionAnalyzeInput, VisionAnalyzeResult, VisionProviderId } from "./types";

export class AnalysisError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AnalysisError";
    this.statusCode = statusCode;
  }
}

export async function runAnalysis(
  providerId: VisionProviderId,
  input: VisionAnalyzeInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<VisionAnalyzeResult> {
  if (!isVisionProviderId(providerId)) {
    throw new AnalysisError("未知の解析TOOLです", 400);
  }

  const meta = getProviderMeta(providerId);
  if (meta?.requiresPrompt && !input.prompt.trim()) {
    throw new AnalysisError("命令テキストを入力してください", 400);
  }

  const usdJpy = Number(env.COST_USD_JPY) || undefined;

  switch (providerId) {
    case "claude": {
      const apiKey = requireApiKey("ANTHROPIC_API_KEY", env);
      const prepared = await prepareForVision(input, env);
      const result = await analyzeWithClaude(prepared, {
        apiKey,
        model: env.ANTHROPIC_VISION_MODEL || "claude-sonnet-4-5",
      });
      return withCost("claude", result, usdJpy);
    }
    case "gpt-4o": {
      const apiKey = requireApiKey("OPENAI_API_KEY", env);
      const prepared = await prepareForVision(input, env);
      const result = await analyzeWithOpenAI(prepared, {
        apiKey,
        model: env.OPENAI_GPT4O_MODEL || "gpt-4o",
      });
      return withCost("gpt-4o", result, usdJpy);
    }
    case "gpt-5": {
      const apiKey = requireApiKey("OPENAI_API_KEY", env);
      const prepared = await prepareForVision(input, env);
      const result = await analyzeWithOpenAI(prepared, {
        apiKey,
        model: env.OPENAI_GPT5_MODEL || "gpt-5",
      });
      return withCost("gpt-5", result, usdJpy);
    }
    case "gemini": {
      const apiKey = requireApiKey("GEMINI_API_KEY", env);
      const prepared = await prepareForVision(input, env);
      const result = await analyzeWithGemini(prepared, {
        apiKey,
        model: env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
      });
      return withCost("gemini", result, usdJpy);
    }
    case "plate-recognizer": {
      requireApiKey("PLATE_RECOGNIZER_API_KEY", env);
      const prepared = await prepareVisionImage(input, {
        maxEdgePx: resolveMaxEdgePx("anpr", env),
      });
      const anpr = await recognizePlate(prepared.imageBuffer);
      return withCost(
        "plate-recognizer",
        {
          text: formatAnprResult(anpr),
          raw: anpr.raw,
        },
        usdJpy
      );
    }
  }
}

async function prepareForVision(
  input: VisionAnalyzeInput,
  env: NodeJS.ProcessEnv
): Promise<VisionAnalyzeInput> {
  return prepareVisionImage(input, {
    maxEdgePx: resolveMaxEdgePx("vision", env),
  });
}

function withCost(
  provider: VisionProviderId,
  result: VisionAnalyzeResult,
  usdJpy?: number
): VisionAnalyzeResult {
  return {
    ...result,
    estimatedCostYen: estimateCostYen(provider, result.raw, { usdJpy }),
  };
}

function requireApiKey(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new AnalysisError(`${name} のAPIキーが未設定です`, 503);
  }
  return value;
}
