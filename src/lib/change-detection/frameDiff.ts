import sharp from "sharp";
import pixelmatch from "pixelmatch";
import { ssim } from "ssim.js";

/**
 * Perceptual diff used to decide whether two consecutive captures show a
 * meaningful change worth analyzing/notifying on. Vendor-agnostic (works
 * identically on ONVIF or SoraCam footage).
 *
 * A plain per-pixel luma diff (the previous implementation) misses two
 * common cases: an object whose color is close to the background
 * disappearing, and a small object vanishing from a busy/cluttered scene —
 * in both cases the raw pixel delta is small relative to the overall frame.
 * To catch those, three complementary signals are combined after a shared
 * Sharp preprocessing pass (resize + grayscale + normalize + light blur,
 * which removes color and exposure noise so the metrics below compare
 * structure rather than lighting):
 *  - SSIM (structural similarity): sensitive to changes in local structure
 *    even when average brightness/color barely moves.
 *  - Sobel gradient-magnitude diff: sensitive to edges appearing/disappearing,
 *    which is exactly what happens when an object is added/removed.
 *  - pixelmatch: a lightweight, well-tested per-pixel diff kept as a minor
 *    supporting signal (this is what the old implementation relied on alone).
 */

const PROCESS_SIZE = 512;
// A very light blur (e.g. sigma 0.3) is not enough to suppress ordinary
// frame-to-frame sensor/JPEG re-encode noise once SSIM is in the mix —
// SSIM reacts strongly to spatially uncorrelated noise between two
// independent captures of an unchanged scene. 1.2 was chosen empirically
// as a balance: strong enough to keep a static scene's score near zero,
// still small enough to preserve a real object's structural signature.
const BLUR_SIGMA = 1.2;
const PIXELMATCH_THRESHOLD = 0.1;

const WEIGHT_SSIM = 0.5;
const WEIGHT_GRADIENT = 0.3;
const WEIGHT_PIXELMATCH = 0.2;

// Max possible Sobel gradient magnitude for 8-bit input, used to normalize
// the gradient diff into a 0..1 range comparable to the other signals.
const MAX_SOBEL_MAGNITUDE = 4 * 255 * Math.SQRT2;

type ProcessedFrame = {
  data: Buffer;
  width: number;
  height: number;
};

type RgbaImage = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

async function preprocess(
  buffer: Buffer,
  target?: { width: number; height: number }
): Promise<ProcessedFrame> {
  const pipeline = sharp(buffer).grayscale().normalize().blur(BLUR_SIGMA);
  const resized = target
    ? // 直前フレームと同じ寸法に強制する（アスペクト比が同じなら劣化なし。
      // カメラ解像度が途中で変わった場合でも比較不能でクラッシュしないようにする）
      pipeline.resize(target.width, target.height, { fit: "fill" })
    : pipeline.resize(PROCESS_SIZE, PROCESS_SIZE, { fit: "inside", withoutEnlargement: true });
  const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// ssim.js and pixelmatch both hard-code a 4-byte (RGBA) pixel stride, so the
// single-channel grayscale buffer from Sharp needs to be expanded first.
function toRgba(frame: ProcessedFrame): RgbaImage {
  const rgba = new Uint8ClampedArray(frame.width * frame.height * 4);
  for (let i = 0; i < frame.data.length; i++) {
    const value = frame.data[i];
    const offset = i * 4;
    rgba[offset] = value;
    rgba[offset + 1] = value;
    rgba[offset + 2] = value;
    rgba[offset + 3] = 255;
  }
  return { data: rgba, width: frame.width, height: frame.height };
}

function sobelMagnitude(frame: ProcessedFrame): Float64Array {
  const { data, width, height } = frame;
  const magnitude = new Float64Array(width * height);
  const at = (x: number, y: number): number => {
    const clampedX = Math.min(width - 1, Math.max(0, x));
    const clampedY = Math.min(height - 1, Math.max(0, y));
    return data[clampedY * width + clampedX];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        -at(x - 1, y - 1) + at(x + 1, y - 1) - 2 * at(x - 1, y) + 2 * at(x + 1, y) - at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy =
        -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      magnitude[y * width + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return magnitude;
}

function gradientDiffScore(a: ProcessedFrame, b: ProcessedFrame): number {
  const magA = sobelMagnitude(a);
  const magB = sobelMagnitude(b);
  let sum = 0;
  for (let i = 0; i < magA.length; i++) {
    sum += Math.abs(magA[i] - magB[i]);
  }
  const meanDiff = sum / magA.length;
  return Math.min(1, meanDiff / MAX_SOBEL_MAGNITUDE);
}

export async function frameDiffScore(prev: Buffer, curr: Buffer): Promise<number> {
  const a = await preprocess(prev);
  const b = await preprocess(curr, { width: a.width, height: a.height });

  const rgbaA = toRgba(a);
  const rgbaB = toRgba(b);

  const { mssim } = ssim(rgbaA, rgbaB);
  const ssimDiff = 1 - mssim;

  const gradientDiff = gradientDiffScore(a, b);

  const diffPixels = pixelmatch(rgbaA.data, rgbaB.data, undefined, a.width, a.height, {
    threshold: PIXELMATCH_THRESHOLD,
  });
  const pixelmatchRatio = diffPixels / (a.width * a.height);

  return (
    WEIGHT_SSIM * ssimDiff + WEIGHT_GRADIENT * gradientDiff + WEIGHT_PIXELMATCH * pixelmatchRatio
  );
}
