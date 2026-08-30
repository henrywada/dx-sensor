import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { frameDiffScore } from "./frameDiff";

const WIDTH = 200;
const HEIGHT = 200;
const BACKGROUND: [number, number, number] = [210, 210, 210];

type SetPixel = (x: number, y: number, rgb: [number, number, number]) => void;

async function makeImage(paint: (set: SetPixel) => void): Promise<Buffer> {
  const raw = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let i = 0; i < raw.length; i += 3) {
    raw[i] = BACKGROUND[0];
    raw[i + 1] = BACKGROUND[1];
    raw[i + 2] = BACKGROUND[2];
  }
  const set: SetPixel = (x, y, rgb) => {
    const i = (y * WIDTH + x) * 3;
    raw[i] = rgb[0];
    raw[i + 1] = rgb[1];
    raw[i + 2] = rgb[2];
  };
  paint(set);
  return sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
}

function fillRect(
  set: SetPixel,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: [number, number, number]
) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      set(x, y, rgb);
    }
  }
}

const paintClutter: (set: SetPixel) => void = (set) => {
  fillRect(set, 10, 10, 20, 20, [150, 150, 150]);
  fillRect(set, 150, 20, 25, 15, [170, 170, 170]);
  fillRect(set, 30, 150, 15, 30, [130, 130, 130]);
  fillRect(set, 120, 120, 30, 30, [180, 180, 180]);
};

/** 同一シーンでも露出/明るさが少し揺れただけ、という「変化なし」の現実的な基準値を作る。 */
async function withBrightnessShift(image: Buffer, delta: number): Promise<Buffer> {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const shifted = Buffer.from(data.map((v) => Math.min(255, Math.max(0, v + delta))));
  return sharp(shifted, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer();
}

describe("frameDiffScore", () => {
  it("returns a near-zero score for identical images", async () => {
    const image = await makeImage(() => {});
    const score = await frameDiffScore(image, image);
    expect(score).toBeLessThan(0.001);
  });

  it("stays low when only overall brightness shifts slightly (no structural change)", async () => {
    const base = await makeImage((set) => fillRect(set, 60, 60, 30, 30, [140, 140, 140]));
    const brighter = await withBrightnessShift(base, 8);

    const score = await frameDiffScore(base, brighter);
    expect(score).toBeLessThan(0.005);
  });

  it("detects an object disappearing even when its color is close to the background", async () => {
    const withObject = await makeImage((set) => fillRect(set, 80, 80, 40, 40, [195, 195, 195]));
    const withoutObject = await makeImage(() => {});
    const noiseFloor = await frameDiffScore(withObject, await withBrightnessShift(withObject, 8));

    const score = await frameDiffScore(withObject, withoutObject);

    expect(score).toBeGreaterThan(noiseFloor * 10);
    expect(score).toBeGreaterThan(0.01);
  });

  it("detects a small object disappearing from a cluttered background", async () => {
    const withObject = await makeImage((set) => {
      paintClutter(set);
      fillRect(set, 80, 80, 25, 25, [200, 200, 200]);
    });
    const withoutObject = await makeImage(paintClutter);
    const noiseFloor = await frameDiffScore(
      withoutObject,
      await withBrightnessShift(withoutObject, 8)
    );

    const score = await frameDiffScore(withObject, withoutObject);

    expect(score).toBeGreaterThan(noiseFloor * 10);
    expect(score).toBeGreaterThan(0.005);
  });

  it("handles a resolution change between captures without throwing", async () => {
    const a = await makeImage((set) => fillRect(set, 80, 80, 40, 40, [195, 195, 195]));
    const bRaw = await sharp(await makeImage(() => {}))
      .resize(100, 100)
      .png()
      .toBuffer();

    await expect(frameDiffScore(a, bRaw)).resolves.toEqual(expect.any(Number));
  });
});
