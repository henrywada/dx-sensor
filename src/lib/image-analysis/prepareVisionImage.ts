import sharp from "sharp";
import type { VisionAnalyzeInput } from "./types";

/** Claude 標準ティアの長辺目安。トークン頭打ち付近に合わせる */
export const DEFAULT_VISION_MAX_EDGE_PX = 1568;

/** ANPR向け。細部を残すためやや大きめ */
export const DEFAULT_ANPR_MAX_EDGE_PX = 2048;

export const DEFAULT_VISION_JPEG_QUALITY = 85;

export type PrepareVisionImageOptions = {
  maxEdgePx?: number;
  jpegQuality?: number;
};

/**
 * 解析API送出前の共通前処理。
 * Storageの原寸は触らず、送信用バッファだけ縮小・JPEG化する。
 */
export async function prepareVisionImage(
  input: VisionAnalyzeInput,
  options: PrepareVisionImageOptions = {}
): Promise<VisionAnalyzeInput> {
  const maxEdgePx = options.maxEdgePx ?? DEFAULT_VISION_MAX_EDGE_PX;
  const jpegQuality = options.jpegQuality ?? DEFAULT_VISION_JPEG_QUALITY;

  const imageBuffer = await sharp(input.imageBuffer)
    .rotate() // EXIF向きを反映
    .resize({
      width: maxEdgePx,
      height: maxEdgePx,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: jpegQuality, mozjpeg: true })
    .toBuffer();

  return {
    ...input,
    imageBuffer,
    mimeType: "image/jpeg",
  };
}

export function resolveMaxEdgePx(
  kind: "vision" | "anpr",
  env: NodeJS.ProcessEnv = process.env
): number {
  if (kind === "anpr") {
    const raw = Number(env.VISION_ANPR_MAX_EDGE_PX);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ANPR_MAX_EDGE_PX;
  }
  const raw = Number(env.VISION_MAX_EDGE_PX);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VISION_MAX_EDGE_PX;
}
