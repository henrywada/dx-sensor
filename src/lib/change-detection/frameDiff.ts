import sharp from "sharp";

/**
 * Simple perceptual diff: downscale both frames to a small grayscale
 * image and compare mean pixel difference. Vendor-agnostic (works
 * identically on ONVIF or SoraCam footage) and cheap enough to run
 * on every poll tick.
 *
 * This mirrors agent/src/index.ts's frameDiffScore(). The two copies
 * exist because the agent (Raspberry Pi) and the main app (Vercel) are
 * separate npm packages with no shared workspace set up yet — see
 * agent/src/index.ts's file header for the same tradeoff noted there.
 * If this logic needs to change, update both copies.
 */
export async function frameDiffScore(prev: Buffer, curr: Buffer): Promise<number> {
  const size = 64;
  const [a, b] = await Promise.all([
    sharp(prev).resize(size, size).grayscale().raw().toBuffer(),
    sharp(curr).resize(size, size).grayscale().raw().toBuffer(),
  ]);
  let diffPixels = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 25) diffPixels++;
  }
  return diffPixels / a.length;
}
