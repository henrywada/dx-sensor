import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { buildZoneComposite, type NormalizedZoneRect } from "./zoneCrop";

const WIDTH = 200;
const HEIGHT = 100;
const RED: [number, number, number] = [220, 30, 30];
const BLUE: [number, number, number] = [30, 30, 220];
const BACKGROUND: [number, number, number] = [10, 10, 10];

async function makeSplitImage(): Promise<Buffer> {
  // 左半分(0..100px)を赤、右半分(100..200px)を青にする。
  const raw = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 3;
      const color = x < WIDTH / 2 ? RED : BLUE;
      raw[i] = color[0];
      raw[i + 1] = color[1];
      raw[i + 2] = color[2];
    }
  }
  return sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .png()
    .toBuffer();
}

async function samplePixel(buffer: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const i = (y * info.width + x) * channels;
  return [data[i], data[i + 1], data[i + 2]];
}

describe("buildZoneComposite", () => {
  it("ゾーンが無ければ元画像をそのまま返す", async () => {
    const image = await makeSplitImage();
    const result = await buildZoneComposite(image, []);
    expect(result).toBe(image);
  });

  it("単一ゾーンをその範囲だけ切り出す", async () => {
    const image = await makeSplitImage();
    const zones: NormalizedZoneRect[] = [{ x: 0, y: 0, width: 0.5, height: 1 }];

    const result = await buildZoneComposite(image, zones);
    const [r, g, b] = await samplePixel(result, 10, 10);

    expect([r, g, b]).toEqual(RED);
  });

  it("複数ゾーンを横並びの1枚に合成する（左に1つ目、右寄りに2つ目の色が現れる）", async () => {
    const image = await makeSplitImage();
    const zones: NormalizedZoneRect[] = [
      { x: 0, y: 0, width: 0.5, height: 1 }, // 赤ゾーン
      { x: 0.5, y: 0, width: 0.5, height: 1 }, // 青ゾーン
    ];

    const result = await buildZoneComposite(image, zones);
    const leftPixel = await samplePixel(result, 5, 5);
    const rightPixel = await samplePixel(result, 195, 5);

    expect(leftPixel).toEqual(RED);
    expect(rightPixel).toEqual(BLUE);
  });
});
