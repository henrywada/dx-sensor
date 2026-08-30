import sharp from "sharp";

/** 監視ゾーンの矩形。すべて基本写真の幅・高さに対する正規化比率(0..1)。 */
export type NormalizedZoneRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const GAP_PX = 4;
const BACKGROUND_RGB = { r: 0, g: 0, b: 0 };

type PixelRect = { left: number; top: number; width: number; height: number };

function toPixelRect(
  zone: NormalizedZoneRect,
  imageWidth: number,
  imageHeight: number
): PixelRect {
  const left = Math.min(imageWidth - 1, Math.max(0, Math.round(zone.x * imageWidth)));
  const top = Math.min(imageHeight - 1, Math.max(0, Math.round(zone.y * imageHeight)));
  const width = Math.max(1, Math.min(imageWidth - left, Math.round(zone.width * imageWidth)));
  const height = Math.max(1, Math.min(imageHeight - top, Math.round(zone.height * imageHeight)));
  return { left, top, width, height };
}

/**
 * 監視ゾーン（正規化座標）で画像を切り出す。複数ゾーンは横一列に並べて
 * 1枚の画像へ合成する（既存のdiffScore計算・Gemini解析は「1枚の画像」を
 * 前提にしたシグネチャのままにしたいため）。ゾーンが無指定なら元画像を
 * そのまま返す（従来通り全体画像で解析する）。
 */
export async function buildZoneComposite(
  imageBuffer: Buffer,
  zones: NormalizedZoneRect[]
): Promise<Buffer> {
  if (zones.length === 0) return imageBuffer;

  const metadata = await sharp(imageBuffer).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;
  if (!imageWidth || !imageHeight) return imageBuffer;

  const crops = await Promise.all(
    zones.map(async (zone) => {
      const pixelRect = toPixelRect(zone, imageWidth, imageHeight);
      const buffer = await sharp(imageBuffer).extract(pixelRect).toBuffer();
      return { buffer, width: pixelRect.width, height: pixelRect.height };
    })
  );

  const canvasWidth =
    crops.reduce((sum, crop) => sum + crop.width, 0) + GAP_PX * (crops.length - 1);
  const canvasHeight = Math.max(...crops.map((crop) => crop.height));

  let left = 0;
  const composites = crops.map((crop) => {
    const placed = { input: crop.buffer, left, top: 0 };
    left += crop.width + GAP_PX;
    return placed;
  });

  return sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: BACKGROUND_RGB,
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}
