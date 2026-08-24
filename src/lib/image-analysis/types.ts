export type VisionProviderId =
  | "claude"
  | "gpt-4o"
  | "gpt-5"
  | "gemini"
  | "plate-recognizer";

export interface VisionProviderMeta {
  id: VisionProviderId;
  label: string;
  requiresPrompt: boolean;
}

export interface VisionAnalyzeInput {
  imageBuffer: Buffer;
  mimeType: string;
  prompt: string;
}

export interface VisionAnalyzeResult {
  text: string;
  raw?: unknown;
  /** 消費概算コスト（円）。算出できない場合は null/undefined */
  estimatedCostYen?: number | null;
}

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;
