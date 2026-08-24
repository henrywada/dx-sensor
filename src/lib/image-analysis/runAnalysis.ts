import sharp from "sharp";
import { analyzeWithClaude } from "./claude-vision/claudeVision";
import { analyzeWithGemini } from "./gemini/gemini";
import { analyzeWithOpenAI } from "./openai-vision/openaiVision";
import { formatAnprResult } from "./plate-recognizer/formatAnprResult";
import { recognizePlate } from "./plate-recognizer/plateRecognizer";
import { getProviderMeta, isVisionProviderId } from "./providers";
import type { VisionAnalyzeInput, VisionAnalyzeResult, VisionProviderId } from "./types";

const VISION_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

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

  switch (providerId) {
    case "claude": {
      const prepared = await normalizeForVision(input);
      return analyzeWithClaude(prepared, {
        apiKey: requireApiKey("ANTHROPIC_API_KEY", env),
        model: env.ANTHROPIC_VISION_MODEL || "claude-sonnet-4-5",
      });
    }
    case "gpt-4o": {
      const prepared = await normalizeForVision(input);
      return analyzeWithOpenAI(prepared, {
        apiKey: requireApiKey("OPENAI_API_KEY", env),
        model: env.OPENAI_GPT4O_MODEL || "gpt-4o",
      });
    }
    case "gpt-5": {
      const prepared = await normalizeForVision(input);
      return analyzeWithOpenAI(prepared, {
        apiKey: requireApiKey("OPENAI_API_KEY", env),
        model: env.OPENAI_GPT5_MODEL || "gpt-5",
      });
    }
    case "gemini": {
      const prepared = await normalizeForVision(input);
      return analyzeWithGemini(prepared, {
        apiKey: requireApiKey("GEMINI_API_KEY", env),
        model: env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
      });
    }
    case "plate-recognizer": {
      requireApiKey("PLATE_RECOGNIZER_API_KEY", env);
      const anpr = await recognizePlate(input.imageBuffer);
      return { text: formatAnprResult(anpr), raw: anpr.raw };
    }
  }
}

function requireApiKey(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new AnalysisError(`${name} のAPIキーが未設定です`, 503);
  }
  return value;
}

async function normalizeForVision(input: VisionAnalyzeInput): Promise<VisionAnalyzeInput> {
  if (VISION_MIME_TYPES.has(input.mimeType)) return input;
  const imageBuffer = await sharp(input.imageBuffer).jpeg({ quality: 90 }).toBuffer();
  return { ...input, imageBuffer, mimeType: "image/jpeg" };
}
